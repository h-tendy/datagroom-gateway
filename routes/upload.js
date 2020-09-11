const router = require('express').Router();
const multer = require('multer');
const ExcelUtils = require('../excelUtils');

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
        'application/vnd.ms-excel',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
        'application/vnd.ms-excel.sheet.macroEnabled.12',
        'application/vnd.ms-excel.template.macroEnabled.12',
        'application/vnd.ms-excel.addin.macroEnabled.12',
        'application/vnd.ms-excel.sheet.binary.macroEnabled.12'
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
            return res.send('Please select an excel file to upload');
        }
        else if (err instanceof multer.MulterError) {
            return res.send(err);
        }
        else if (err) {
            return res.send(err);
        }
        console.log("Upload complete. File: ", JSON.stringify(req.file, null, 4));
        try {
            let excelUtils = await ExcelUtils.getExcelUtilsForFile(req.file.path);
            let sheetNames = excelUtils.getSheetNames();
            res.status(200).send(sheetNames);
        } catch (e) {
            res.status(415).send(e);
        }
        //res.status(200).json({message: 'ok'});
        //res.json({message: 'ok'});
    });    
});

// Not used. 
router.post('/findHeadersInSheet', async (req, res, next) => {
    let request = req.body;
    console.log("In findHeadersInSheet: ", request);
    try {
        let excelUtils = await ExcelUtils.getExcelUtilsForFile("uploads/" + request.fileName);
        let hdrsInSheet = excelUtils.findHeadersInSheet(request.sheetName);
        res.status(200).send(hdrsInSheet);
    } catch (e) {
        res.status(415).send(e);
    }
});

router.post('/loadHdrsFromRange', async (req, res, next) => {
    let request = req.body;
    console.log("In loadHdrsFromRange: ", request);
    try {
        let excelUtils = await ExcelUtils.getExcelUtilsForFile("uploads/" + request.fileName);
        let loadStatus = await excelUtils.loadHdrsFromRange(request.sheetName, request.selectedRange);
        res.status(200).send(loadStatus);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});

router.post('/createDs', async (req, res, next) => {
    let request = req.body;
    console.log("In createDs: ", request);
    try {
        let excelUtils = await ExcelUtils.getExcelUtilsForFile("uploads/" + request.fileName);
        let loadStatus = await excelUtils.loadHdrsFromRange(request.sheetName, request.selectedRange);
        if (loadStatus.loadStatus) {
            loadStatus = await excelUtils.loadDataIntoDb(request.sheetName, request.selectedRange, loadStatus.hdrs, request.selectedKeys, request.dsName, request.dsUser)
            // If selectedKeys is empty, then you should insertMany.
            // Else, you can update with upsert as true. 
        }

        res.status(200).send(loadStatus);
    } catch (e) {
        console.log("Got exception: ", e);
        res.status(415).send(e);
    }
});

module.exports = router;