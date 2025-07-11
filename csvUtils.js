const Fs = require('fs');
const DbAbstraction = require('./dbAbstraction');
const CsvReadableStream = require('csv-reader');
const logger = require('./logger');

class CsvUtils {

    static async findHdrs (file) {
        return new Promise((resolve, reject) => {
            let inputStream = Fs.createReadStream(file, 'utf8');
             inputStream
                .pipe(new CsvReadableStream({ parseNumbers: true, parseBooleans: true, trim: true }))
                .on('data', function (row) {
                    logger.info(row, "A row data arrived");
                })
                .on('end', function (data) {
                    logger.info('No more rows!');
                })
                .on ('header', function (hdr) {
                    logger.info(hdr, 'Header');
                    inputStream.destroy();
                    resolve(hdr);
                });
        });   
    }

    static async loadDataIntoDb (file, keys, dsName, dsUser) {

        return new Promise(async (resolve, reject) => {
            logger.info(`File: ${file} keys: ${keys} dsName: ${dsName} dsUser: ${dsUser}`);
            let dbAbstraction = new DbAbstraction();
            // Check if db already exists...
            let dbList = await dbAbstraction.listDatabases();
            for (let i = 0; i < dbList.length; i++) {
                if (dbList[i].name === dsName) {
                    logger.warn(`${dsName} Dataset name conflict`);
                    reject ({ loadStatus: false, error: 'Dataset name conflict' });
                    dbAbstraction.destroy();
                    return;
                }
            }
            let hdrs = [];
            let inputStream = Fs.createReadStream(file, 'utf8');
             inputStream
                .pipe(new CsvReadableStream({ asObject: true, parseNumbers: true, parseBooleans: true, trim: true }))
                .on('data', async function (rowObjForDb) {
                    // From here on, you can insert the rows into database. 
                    logger.info(rowObjForDb, "Row object");
                    let rowSelectorObj = {};
                    keys.map((k) => {
                        rowSelectorObj[k] = rowObjForDb[k];
                    });
                    logger.info(rowSelectorObj, "Row selector obj");
                    try {
                        await dbAbstraction.update(dsName, "data", rowSelectorObj, rowObjForDb);
                    } catch (e) {
                        logger.error(e, "Db update error in loadDataInDb");
                    }
                })
                .on ('header', function (h) {
                    logger.info(h, 'Header');
                    hdrs = h;
                })
                .on('end', async function (data) {
                    // Do meta data stuff here. 
                    try {
                        await dbAbstraction.update(dsName, "metaData", { _id: "perms" }, { owner: dsUser });
                        await dbAbstraction.update(dsName, "metaData", { _id: "keys" }, { keys });
                        let columns = {};
                        let columnAttrs = [];
                        for (let i = 0; i < Object.keys(hdrs).length; i++) {
                            let attrs = {};
                            attrs.field = hdrs[i];
                            attrs.title = hdrs[i];
                            attrs.width = 150;
                            attrs.editor = "textarea";
                            attrs.editorParams = {};
                            attrs.formatter = "textarea";
                            attrs.headerFilterType = "input";
                            attrs.hozAlign = "center";
                            attrs.vertAlign = "middle";
                            attrs.headerTooltip = true;
                            columnAttrs.push(attrs);
                            columns[i + 1] = hdrs[i];
                        }
                        await dbAbstraction.update(dsName, "metaData", { _id: `view_default` }, { columns, columnAttrs, userColumnAttrs: { } } );
                    } catch (e) {
                        logger.error(e, "Db metaData update error");
                    }            
                    resolve ({ loadStatus: true, hdrs })
                    await dbAbstraction.destroy();
                });

        });   
    }

}

module.exports = CsvUtils;