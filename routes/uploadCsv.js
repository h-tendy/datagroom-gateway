const router = require('express').Router();
const multer = require('multer');
const ExcelUtils = require('../excelUtils');
const CsvUtils = require('../csvUtils');

var upload = multer({
    storage: multer.diskStorage({
        destination: (r, f, cb) => cb(null, 'uploads/'),
        filename: (r, f, cb) => {
            cb(null, f.originalname);
        }
    }),
    fileFilter
}).single('file');

function fileFilter(r, f, cb) {
    console.log("Received request for upload: ", f.mimetype)
    let supportedMimeTypes = [
        'application/vnd.ms-excel',
        'text/csv'
    ]
    if (supportedMimeTypes.includes(f.mimetype)) cb(null, true);
    else cb(null, false);
}


router.post('/', (req, res, next) => {
    upload(req, res, async function(err) {
        // req.file contains information of uploaded file
        // req.body contains information of text fields, if there were any
        if (req.fileValidationError) {
            return res.send(req.fileValidationError);
        }
        else if (!req.file) {
            return res.send('Please select a csv file to upload');
        }
        else if (err instanceof multer.MulterError) {
            return res.send(err);
        }
        else if (err) {
            return res.send(err);
        }
        console.log("Upload complete. File: ", JSON.stringify(req.file, null, 4));
        try {
            let hdrs = await CsvUtils.findHdrs(req.file.path);
            console.log("Hdrs: ", hdrs);
            res.status(200).send(hdrs);
        } catch (e) {
            console.log("Caught exception: ", e);
            res.status(415).send(e);
        }
    });    
});


router.post('/createDs', async (req, res, next) => {
    let request = req.body;
    console.log("In createDs: ", request);
    try {

        let loadStatus = await CsvUtils.loadDataIntoDb("uploads/" + request.fileName, request.selectedKeys, request.dsName, request.dsUser);
        // If selectedKeys is empty, then you should insertMany.
        // Else, you can update with upsert as true. 

        res.status(200).send(loadStatus);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});

module.exports = router;