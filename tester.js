var express = require('express');
var app = express();
var server = require('http')
	.createServer(app);
var redis = require('redis');
var util = require('util');
var ursa = require('ursa');
var fs = require('fs');
var crypto = require('crypto');
var io = require('socket.io')
	.listen(server);  
var log = require('./log');

var config = require('./node_config');

var serverAddress = config.serverAddress;
var publicKey;

try {
  var md5 = crypto.createHash('md5')
    .update(serverAddress)
    .digest("hex");
  var keyPem = fs.readFileSync(__dirname + '/public_keys/' + md5 + '.pub');
  publicKey = ursa.createPublicKey(keyPem);
  log.info(util.format('Public key loaded for node server "%s"', serverAddress));
} catch(e) {
  log.warning(util.format('Cannot load public key for node server "%s"', serverAddress));
}



var buffer = new Buffer('JOINROOM:flvoir|John', 'utf8')
var result = publicKey.hashAndVerify('sha256', buffer, "pwxySX0T7v+HJU6UVfKhek2H5BPCHbKBc+4iAz7jLyHECeRy/frJM3TX1vz6+rnWTQSoreubP3VcDlq1P3nCWTFmgxjtPe9+3bSO7BJq7GB5KwHigE9jzXDzCa5d30h/TrfCdE6rCJnLyXPlW3LObAtOldu2I6T2FNNDfp0Wx+izvxIQHf4WwvQvd15+Pu+KgL41dw3aoZZLDBm7UyRMpIN0okPJf/MG0djfdtlxpcLicIJWmjasIY9iXrMpD+tjqRBWFvuCHB/ys7p3j7r3E0ryHJL7uTuhTKfRpFfEPV+EcvsBkAdTVtzOMythZqodIatkEMJ1/cbzeoZaKVlPaw==", 'base64');
  
  
console.log(result);