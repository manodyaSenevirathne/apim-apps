const fs = require('fs');
const AWS = require('aws-sdk');
const archiver = require('archiver');
var nodemailer = require('nodemailer');

// Enter copied or downloaded access ID and secret key here
const ID = '';
const SECRET = '';

// The name of the bucket that you have created
const BUCKET_NAME = 'apim-ui-testing';
var secretAccessKey = process.env.S3_SECRET_KEY;
var accessKeyId = process.env.S3_ACCESS_KEY;
var testGridEmailPWD = process.env.TESTGRID_EMAIL_PASSWORD;


const s3 = new AWS.S3({
  accessKeyId: accessKeyId,
  secretAccessKey: secretAccessKey
});

var timestamp = new Date() / 1000;

const uploadFile = (fileName, destination, contentType) => {
  // Read content from the file
  const fileContent = fs.readFileSync(fileName);
  // Setting up S3 upload parameters
  const params = {
      Bucket: BUCKET_NAME,
      Key: destination, // File name you want to save as in S3
      Body: fileContent,
      ACL: 'public-read',
      ContentType : contentType
  };
  // Uploading files to the bucket
  s3.upload(params, function(err, data) {
      if (err) {
          // throw err;
          console.log(`File uploaded Error to AWS s3 bucket.`);
      }
      console.log(`File uploaded successfully. ${data.Location}`);   
  });
};

function zipDirectory(sourceDir, outPath) {
  const archive = archiver('zip', { zlib: { level: 9 }});
  const stream = fs.createWriteStream(outPath);

  return new Promise((resolve, reject) => {
    archive
      .directory(sourceDir, false)
      .on('error', err => reject(err))
      .pipe(stream)
    ;

    stream.on('close', () => resolve());
    archive.finalize();
  });
}

uploadFile('./cypress/reports/html/mochawesome-bundle.html', `440-result/mochawesome-bundle-${timestamp}.html`, "text/html");
var zipFileOutputLocation = `./cypress/screenshots-${timestamp}.zip`;
zipDirectory('./cypress/screenshots', zipFileOutputLocation).then(()=>{
  uploadFile(zipFileOutputLocation, `440-result/screenshots-${timestamp}.zip`, "application/zip")
});