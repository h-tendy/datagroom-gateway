const Fs = require('fs');
const DbAbstraction = require('./dbAbstraction');
const CsvReadableStream = require('csv-reader');

class CsvUtils {

    static async findHdrs (file) {
        return new Promise((resolve, reject) => {
            let inputStream = Fs.createReadStream(file, 'utf8');
             inputStream
                .pipe(new CsvReadableStream({ parseNumbers: true, parseBooleans: true, trim: true }))
                .on('data', function (row) {
                    console.log('A row arrived: ', row);
                })
                .on('end', function (data) {
                    console.log('No more rows!');
                })
                .on ('header', function (hdr) {
                    console.log('Header: ', hdr);
                    inputStream.destroy();
                    resolve(hdr);
                });
        });   
    }

    static async loadDataIntoDb (file, keys, dsName, dsUser) {

        return new Promise(async (resolve, reject) => {
            console.log("file, keys, dsName, dsUser: ", file, keys, dsName, dsUser);
            let dbAbstraction = new DbAbstraction();
            // Check if db already exists...
            let dbList = await dbAbstraction.listDatabases();
            for (let i = 0; i < dbList.length; i++) {
                if (dbList[i].name === dsName) {
                    console.log('Dataset name conflict');
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
                    console.log("Row object: ", rowObjForDb);
                    let rowSelectorObj = {};
                    keys.map((k) => {
                        rowSelectorObj[k] = rowObjForDb[k];
                    });
                    console.log("Row selector obj: ", rowSelectorObj);
                    try {
                        await dbAbstraction.update(dsName, "data", rowSelectorObj, rowObjForDb);
                    } catch (e) {
                        console.log("Db update error: ", e);
                    }
                })
                .on ('header', function (h) {
                    console.log('Header: ', h);
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
                        console.log("Db metaData update error: ", e)
                    }            
                    resolve ({ loadStatus: true, hdrs })
                    await dbAbstraction.destroy();
                });

        });   
    }

}

module.exports = CsvUtils;