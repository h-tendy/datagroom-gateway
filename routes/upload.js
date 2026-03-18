const router = require('express').Router();
const multer = require('multer');
const ExcelUtils = require('../excelUtils');
const logger = require('../logger');

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
    logger.info(`Received request for upload: ${f.mimetype}`);
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


/**
 * @swagger
 * /upload:
 *   post:
 *     summary: Upload an Excel file and return its sheet names
 *     tags: [Upload]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Excel file (.xls, .xlsx)
 *     responses:
 *       200:
 *         description: Array of sheet names in the uploaded workbook
 *       415:
 *         description: Unsupported file type or processing error
 */
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
        logger.info(req.file, "Upload complete for file");
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

/**
 * TODO: Not exposed as it is not used
 * /upload/findHeadersInSheet:
 *   post:
 *     summary: Find column headers in a specific sheet of the uploaded workbook
 *     tags: [Upload]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileName, sheetName]
 *             properties:
 *               fileName: { type: string }
 *               sheetName: { type: string }
 *     responses:
 *       200:
 *         description: Detected header information
 *       415:
 *         description: Processing error
 */
router.post('/findHeadersInSheet', async (req, res, next) => {
    let request = req.body;
    logger.info(request, "Incoming request in findHeadersInSheet");
    try {
        let excelUtils = await ExcelUtils.getExcelUtilsForFile("uploads/" + request.fileName);
        let hdrsInSheet = excelUtils.findHeadersInSheet(request.sheetName);
        res.status(200).send(hdrsInSheet);
    } catch (e) {
        res.status(415).send(e);
    }
});

/**
 * TODO: Not exposed as it is internally used. Need a better mechanism to expose this.
 * /upload/loadHdrsFromRange:
 *   post:
 *     summary: Load column headers from a specific cell range in a sheet
 *     tags: [Upload]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileName, sheetName, selectedRange]
 *             properties:
 *               fileName: { type: string }
 *               sheetName: { type: string }
 *               selectedRange: { type: string, description: Cell range like "A1:G100" }
 *     responses:
 *       200:
 *         description: Headers loaded from range
 *       415:
 *         description: Processing error
 */
router.post('/loadHdrsFromRange', async (req, res, next) => {
    let request = req.body;
    logger.info(request, "Incoming request in loadHdrsFromRange");
    try {
        let excelUtils = await ExcelUtils.getExcelUtilsForFile("uploads/" + request.fileName);
        let loadStatus = await excelUtils.loadHdrsFromRange(request.sheetName, request.selectedRange);
        res.status(200).send(loadStatus);
    } catch (e) {
        logger.error(e, "Exception in loadHdrsFromRange");
        res.status(415).send(e);
    }
});

/**
 * TODO: Not exposed as it is internally used. Need a better mechanism to expose this.
 * /upload/createDs:
 *   post:
 *     summary: Create a new dataset from an uploaded Excel sheet
 *     tags: [Upload]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileName, sheetName, selectedRange, selectedKeys, dsName, dsUser]
 *             properties:
 *               fileName: { type: string }
 *               sheetName: { type: string }
 *               selectedRange: { type: string, description: Cell range like "A1:G100" }
 *               selectedKeys:
 *                 type: array
 *                 items: { type: string }
 *                 description: Column names to use as unique keys
 *               dsName: { type: string, description: Name for the new dataset }
 *               dsUser: { type: string }
 *     responses:
 *       200:
 *         description: Dataset creation result
 *       415:
 *         description: Processing error
 */
router.post('/createDs', async (req, res, next) => {
    let request = req.body;
    logger.info(request, "Incoming request in createDs");
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
        logger.error(e, "Exception in createDs");
        res.status(415).send(e);
    }
});

module.exports = router;