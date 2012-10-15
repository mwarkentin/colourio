var $ = function(el) {
	return document.getElementById(el);
};

var x = 0,
    y = 50,
    width = 480,
    height = 320,
    sampleSize = 1;

var sourceImage = $('SourceImage');
console.log(sourceImage);
var context = sourceImage.getContext('2d');
var source = new Image();
source.src = 'sample-image.jpeg';
source.onload = function() {
	context.drawImage(source, 0, 0, sourceImage.width, sourceImage.height);
	for (x=0; x < sourceImage.width; x++) {
		console.log(x, y);
		console.log(context.getImageData(x, y, sampleSize, sampleSize));
	}
};
