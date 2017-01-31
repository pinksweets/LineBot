'use strict';
var https = require('https');
var aws = require('aws-sdk');
var crypto = require("crypto");

/* AWS SDK */
var s3url = process.env.S3_URL;
var s3 = new aws.S3({
    apiVersion: '2006-03-01',
    region: 'ap-northeast-1'
});
var bucket = 'lambda.replybot';
var extension = '.jpg';
var saveImageToS3 = (img, name, callback) => {
    var savepath = "images/" + name;
    console.log('saveImageToS3: ', name);
    var params = {
        Bucket: bucket,
        Key: savepath,
        ACL: 'public-read',
        Body: img
    };
    s3.putObject(params, (err, data) => {
        if (err) {
            console.log('saveS3 Error : ', JSON.stringify(err, null, 2));
        }
    });
    var imagesPrms = {
        Bucket: bucket,
        Key: "images.json"
    };
    // アップロードした画像をjsonリストに登録
    var imagesData = s3.getObject(imagesPrms, (err, data) => {
        if (err) {
            console.log(JSON.stringify(err, null, 2));
        } else {
            var images = JSON.parse(data.Body.toString());
            images.version++;
            images.images.push(savepath);
            imagesPrms.Body = JSON.stringify(images);
            s3.putObject(imagesPrms, (err, data) => {
                if (err) {
                    console.log('saveS3 putObject Error : ', JSON.stringify(err, null, 2));
                }
            });
        }
    });
};

/* LINE API */
var LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
var LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
var lineHostname = 'api.line.me';
var lineHeader = {
    'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN,
    'Content-Type': 'application/json; charset=UTF-8'
};
var getContentData = (messageId) => {
        return new Promise((resolve, reject) => {
            console.log('getContentOpts(messageId):' + messageId);
            var opts = {
                hostname: lineHostname,
                path: '/v2/bot/message/' + messageId + '/content',
                headers: lineHeader,
                method: 'GET'
            };
            console.log('getContentOpts(opts):', opts);
            var req = https.request(opts, (res) => {
                var data = [];
                console.log('line get content api header:', res.headers);
                res.on('data', (chunk) => {
                    data.push(new Buffer(chunk));
                }).on('error', (e) => {
                    reject(e.stack);
                }).on('end', () => {
                    resolve(Buffer.concat(data));
                });
            });
            req.end();
        });
    },
    replyMessage = (replyToken, text) => {
        var replyOpts = {
                hostname: lineHostname,
                path: '/v2/bot/message/reply',
                headers: lineHeader,
                method: 'POST'
            },
            data = JSON.stringify({
                replyToken: replyToken,
                messages: [{
                    type: "text",
                    text: text
                }]
            });
        var req = https.request(replyOpts, (res) => {
            res.on('data', (res) => {}).on('error', (e) => {});
        });
        req.write(data);
        req.end();
    };

var replyLogic = (data, index) => {
    var replyToken = data.replyToken,
        message = data.message,
        mid = message.id,
        type = message.type;

    console.log('userId:' + data.source.userId);

    var reply = true, text;
    if (type === 'text') {
        text = message.text;
    } else if (type === 'image') {
        text = '貰った写真は\n' + s3url + '\nに掲載していますよ！';
        // get content api利用
        getContentData(message.id).then((img) => {
            saveImageToS3(img, mid + extension);
        }).catch((err) => {
            console.log('getContentData failed:', err);
        });
    } else if (type === 'video') {
        text = 'ビデオファイルを受信';
        // get content api利用
    } else if (type === 'audio') {
        text = '音楽ファイルを受信';
        // get content api利用
    } else if (type === 'location') {
        text = '位置情報を受信';
    } else if (type === 'sticker') {
        text = 'ステッカーを受信';
    } else if (type === 'follow') {
        text = 'フォロー／ブロック解除を受信';
    } else if (type === 'unfollow') {
        text = 'ブロックを受信';
        reply = false;
    } else if (type === 'join') {
        text = 'join';
    } else if (type === 'leave') {
        text = 'leave';
        reply = false;
    } else if (type === 'postback') {
        text = 'postback';
    }
    if (reply) {
        replyMessage(replyToken, text);
    }
};

exports.handler = (event, context, callback) => {

    console.log('Received event:', JSON.stringify(event, null, 2));
    var body = JSON.parse(event.body),
        signature = event.headers["X-Line-Signature"];

    if (body.events) {
        if (crypto.createHmac('sha256', LINE_CHANNEL_SECRET).update(new Buffer(JSON.stringify(body), 'utf8')).digest('base64') === signature) {
            body.events.forEach((data, index) => {
                replyLogic(data);
            });
        } else {
            console.log(" *** X-Line-Signature 検証NG *** ");
        }
    }
};