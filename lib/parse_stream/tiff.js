'use strict';


var ParserStream = require('../common').ParserStream;
var once         = require('../common').once;
var str2arr      = require('../common').str2arr;
var sliceEq      = require('../common').sliceEq;


var SIG_1 = str2arr('II\x2A\0');
var SIG_2 = str2arr('MM\0\x2A');


function readIFDValue(tiff_sig, data, data_offset) {
  var endianness = (tiff_sig[0] === 77 /*'M'*/ ? 'BE' : 'LE');
  var type       = data['readUInt16' + endianness](data_offset + 2);
  var values     = data['readUInt16' + endianness](data_offset + 4);

  if (values !== 1 && (type !== 3 && type !== 4)) {
    return null;
  }

  var depth = (type === 3 ? '16' : '32');

  return data['readUInt' + depth + endianness](data_offset + 8);
}

module.exports = function (input, _callback) {
  var callback = once(_callback);
  var parser = new ParserStream();

  parser.on('unpipe', function () {
    callback();
    return;
  });

  // read header
  parser._bytes(8, function (data) {
    // check TIFF signature
    var sig = data; // signature is 4 bytes only, we keep all 8 to avoid unneeded ops

    if (!sliceEq(sig, 0, SIG_1) && !sliceEq(sig, 0, SIG_2)) {
      parser._skipBytes(Infinity);
      callback();
      return;
    }

    var readUInt16 = (data[0] === 77 /*'M'*/ ? 'readUInt16BE' : 'readUInt16LE');
    var readUInt32 = (data[0] === 77 /*'M'*/ ? 'readUInt32BE' : 'readUInt32LE');

    var count = data[readUInt32](4) - 8;

    if (count < 0) {
      parser._skipBytes(Infinity);
      callback();
      return;
    }

    function safeSkip(parser, count, callback) {
      if (count === 0) { // parser._skipBytes throws error if count === 0
        callback();
        return;
      }

      parser._skipBytes(count, callback);
    }

    // skip until IFD
    safeSkip(parser, count, function () {
      // read number of IFD entries
      parser._bytes(2, function (data) {
        var count = data[readUInt16](0) * 12;

        if (count <= 0) {
          parser._skipBytes(Infinity);
          callback();
          return;
        }

        // read all IFD entries
        parser._bytes(count, function (data) {
          parser._skipBytes(Infinity);

          var i, width, height, tag;

          for (i = 0; i < data.length; i += 12) {
            tag = data[readUInt16](i);

            if (tag === 256) {
              width = readIFDValue(sig, data, i);
            } else if (tag === 257) {
              height = readIFDValue(sig, data, i);
            }
          }

          if (width && height) {
            callback(null, {
              width:  width,
              height: height,
              type:   'tiff',
              mime:   'image/tiff'
            });
          }
        });
      });
    });
  });

  input.pipe(parser);
};