const router = require('express').Router();
const multer = require('multer');
const fs = require("fs");
const PrepAttachments = require('../prepAttachments');
const logger = require('../logger');

var upload = multer({
    storage: multer.diskStorage({
        destination: (r, f, cb) => cb(null, 'attachments/'),
        filename: (r, f, cb) => {
            cb(null, f.originalname);
        }
    }),
    fileFilter
}).single('file');

function fileFilter(r, f, cb) {
    logger.info(`Received request for upload Attachments:  ${f.mimetype}`)
    cb(null, true);
    /*
    let supportedMimeTypes = [
        'image/jpeg',
        'image/png',
        'image/jpg',
        'image/gif'
    ]
    if (supportedMimeTypes.includes(f.mimetype)) cb(null, true);
    else cb(null, false);
    */
}


/**
 * @swagger
 * /uploadAttachments:
 *   post:
 *     summary: Upload an attachment file for a dataset
 *     tags: [Attachments]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, dsName]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Attachment file (any type)
 *               dsName:
 *                 type: string
 *                 description: Dataset name to associate the attachment with
 *     responses:
 *       200:
 *         description: Upload result with the attachment file path
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string }
 *                 filename: { type: string }
 */
router.post('/', (req, res, next) => {
    upload(req, res, async function(err) {
        // req.file contains information of uploaded file
        // req.body contains information of text fields, if there were any
        if (req.fileValidationError) {
            return res.send(req.fileValidationError);
        }
        else if (!req.file) {
            return res.send('Please select image files to upload');
        }
        else if (err instanceof multer.MulterError) {
            return res.send(err);
        }
        else if (err) {
            return res.send(err);
        }
        let dsName = req.body.dsName;
        await fs.promises.mkdir(`attachments/${dsName}`, { recursive: true });
        await fs.promises.rename(`attachments/${req.file.filename}`, `attachments/${dsName}/${req.file.filename}`);
        logger.info(`Req body.dsName: ${req.body.dsName}`);
        logger.info(req.file, "Upload complete for file");
        let fileName = `/attachments/${dsName}/${req.file.filename}`;
        await PrepAttachments.refreshAttachmentsIntoDb();
        res.status(200).send({status: "ok", filename: fileName});
    });    
});

/**
 * TODO: Not working. Need to add relative path handling to make it work
 * /uploadAttachments/deleteAttachment:
 *   post:
 *     summary: Delete an attachment file
 *     tags: [Attachments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dsName, _id]
 *             properties:
 *               dsName: { type: string, description: Dataset name }
 *               _id: { type: string, description: File path of the attachment to delete }
 *     responses:
 *       200:
 *         description: Attachment deleted
 *       415:
 *         description: Error deleting attachment
 */
router.post('/deleteAttachment', async (req, res, next) => {
    let request = req.body;
    logger.info(request, "Incoming request in deleteAttachment");
    try {
        let dsName = request.dsName;
        let _id = request._id;
        await fs.promises.unlink(`${_id}`)
        await PrepAttachments.refreshAttachmentsIntoDb();
        res.status(200).send({status: "ok"});
    } catch (e) {
        logger.error(e, "Exception in deleteAttachment");
        res.status(415).send(e);
    }
});

module.exports = router;