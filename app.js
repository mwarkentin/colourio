var sourceCanvas = $('#Source')[0],
    destinationCanvas = $('#Destination')[0];

var sourceContext = sourceCanvas.getContext('2d'),
    destinationContext = destinationCanvas.getContext('2d');

var x = 0,
    y = 1,
    width = sourceCanvas.width,
    height = sourceCanvas.height,
    sampleSize = 1;

var sourceImage = new Image();
sourceImage.src = 'sample-image.jpeg';
sourceImage.onload = function() {
    sourceContext.drawImage(sourceImage, 0, 0, sourceCanvas.width, sourceCanvas.height);
    drawToDestination(y);
};

$(sourceCanvas).on({
    mousemove: function(e) {
        var y = e.y - e.target.offsetTop;
        drawToDestination(y);
    },
    click: function(e) {
        var img = generatePng(destinationCanvas);
        $('body').append(img);
    }
});

var drawToDestination = function(y) {
    var pixelData = sourceContext.getImageData(x, y, width, sampleSize);
    for (var yy = 0; yy < destinationCanvas.height; yy++) {
        destinationContext.putImageData(pixelData, x, yy);
    }
};

var drawSampleLine = function(y) {
    sourceContext.beginPath();
    sourceContext.moveTo(0, y);
    sourceContext.lineTo(width, y);
    sourceContext.closePath();
    sourceContext.stroke();
};

var generatePng = function(canvas) {
    var img = new Image();
    img.src = canvas.toDataURL();
    return img;
};

var handleDragEnter = function() {
    console.log('hello world!');
};

var handleDragLeave = function() {
    console.log('goodbye world!');
};

var handleOnStart = function(files) {
    console.log('starting upload: ', files);
};

var handleOnSuccess = function(files) {
    console.log('upload success: ', files);
    var file = files[0];
    getUploadedImg(file.url, file.type);
};

var handleOnProgress = function(percentage) {
    console.log('upload progress: ' + percentage + '%');
};

var handleOnError = function(type, message) {
    console.log('error: ', type, message);
};

var getUploadedImg = function(url, type) {
    filepicker.read(url, {base64encode: true}, function(data) {
        var mime = 'data:' + type + ';base64,';
        var imgData = mime + data;
        sourceImage.src = imgData;
    });
};
