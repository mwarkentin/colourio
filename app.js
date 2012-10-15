var $ = function(el) {
	return document.getElementById(el);
};

var sourceImage = $('SourceImage');
console.log(sourceImage);
var context = sourceImage.getContext('2d');
var source = new Image();
source.src = 'sample-image.jpeg';
source.onload = function() {
	context.drawImage(source, 0, 0, sourceImage.width, sourceImage.height);
};
