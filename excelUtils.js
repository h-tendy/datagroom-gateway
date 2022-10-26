require('core-js/modules/es.promise');
require('core-js/modules/es.string.includes');
require('core-js/modules/es.object.assign');
require('core-js/modules/es.object.keys');
require('core-js/modules/es.symbol');
require('core-js/modules/es.symbol.async-iterator');
require('regenerator-runtime/runtime');
const DbAbstraction = require('./dbAbstraction');

const Excel = require('exceljs/dist/es5');
let excelUtilsMap = {};
class ExcelUtils {
    constructor (fileName) {
        this.fileName = fileName;
        this.wBook = null;
        this.workBook = [];
    }
    static async getExcelUtilsForFile (fileName) {
        try {
            let newObj = new ExcelUtils (fileName);
            console.log('About to call init..');
            await newObj.init();
            excelUtilsMap[fileName] = newObj;
            return newObj
        } catch (e) {
            console.log("Exception in ExcelUtils...", e);
        }
        return null;
    }
    async init () {
        this.wBook = new Excel.Workbook();
        console.log('In init, about to call readFile:', this.fileName);
        try {
            await this.wBook.xlsx.readFile(this.fileName);
        } catch (e) {
            /* Ignore this exception. Sometimes, it throws an 
            exception, but reads the file alright */
            console.log("Whoops, couldn't read the file: ", e);
        }
        this.wBook.eachSheet((sheet, sheetId) => {
            let rC = sheet.rowCount;
            let cC = sheet.columnCount;
            this.workBook[sheet.name] = {
                columns: [],
                rows: []
            }
            console.log("Sheet's name is: ", sheet.name);
            for (let i = 1; i <= rC; i++) {
                let str = '';
                let currRow = sheet.getRow(i);
                let row = {};
                for (let j = 1; j <= cC; j++) {
                    this.workBook[sheet.name].columns[j] = j;
                    row[j] = currRow.getCell(j).value || '';
                }
                console.log("Row id: ", i);
                this.workBook[sheet.name].rows.push(Object.getOwnPropertyNames(row).reduce((a, c) => {
                    //a[c] = typeof(row[c]) == 'object' ? getVal(row[c]) : row[c].toString();
                    a[c] = typeof(row[c]) == 'object' ? getVal(row[c]) : row[c];
                    return a;
                }, {}));
                //console.log(this.workBook[sheet.name].rows[i-1]);
            }
            let entries = Object.entries(this.workBook[sheet.name].columns);
            this.workBook[sheet.name].columns = entries.reduce((a, c) => {
                return [...a, { key: c[0], name: c[1] }]
            }, []);
        })
        // Needed within this function only.
        function getVal(obj) {
            if(obj instanceof(Date)) return obj.toString();
            //else if(obj.formula || obj.sharedFormula) return obj.result.error || obj.result.toString();
            else if(obj.formula || obj.sharedFormula) {
                if (obj.result === null || obj.result === undefined) 
                    return "";
                return obj.result.error || obj.result;
            } else if(obj.hyperlink) return obj.text;
            else if(obj.richText) return obj.richText[0].text;
            else if(obj.error) return obj.error;
            else return obj.toString();
        }
    }
    getSheetNames () {
        return Object.keys(this.workBook);
    }

    // Not finished, not needed for now. 
    findHeadersInSheet (sheet) {
        if (!this.workBook[sheet])
            return {};
        console.log(this.workBook[sheet].rows);
        return {};
    }

    // example range - AB12:X45
    getRangeIndices (range) {
        function translateToColumnId (xlsColumn) {
            let intCode = 0;
            for (let i = 0; i < xlsColumn.length; i++) {
                // 1-based column code. i.e. A == 1. 'A' charCode is 65.
                intCode = intCode * 26 + (xlsColumn.charCodeAt(i) - 64)
            }
            return intCode;
        }        
        let ret = { status: true, fromRow: 0, toRow: 0, fromCol: 0, toCol: 0}
        let e = range.toUpperCase().match(/\s*([A-Z]*)([0-9]*):([A-Z]*)([0-9]*)\s*/);
        if (e && (e.length >= 4)) {
            ret.fromCol = translateToColumnId(e[1]);
            ret.toCol = translateToColumnId(e[3]);
            ret.fromRow = parseInt(e[2]) - 1;
            ret.toRow = parseInt(e[4]) - 1;
            console.log(`Alphabets: ..${e[1]}.. && ${e[3]}`);
            console.log(`Digits: ..${e[2]}.. && ${e[4]}`);
        } else {
            ret.status = false;
        }
        return ret;
    }

    async loadHdrsFromRange (sheet, range) {
        await this.init();
        if (!this.workBook[sheet])
            return { loadStatus: false, error: 'Sheet not found' };
        console.log(`Sheet is: ${sheet}, range is: ${range}`);
        let rangeIndices = this.getRangeIndices(range);
        if (!rangeIndices.status)
            return { loadStatus: false, error: 'Bad range' };
        if (rangeIndices.fromRow > rangeIndices.toRow || 
            rangeIndices.fromCol > rangeIndices.toCol)
            return { loadStatus: false, error: 'Invalid range' };
        
        let rowCount = this.workBook[sheet].rows.length;
        let columnCount = this.workBook[sheet].columns.length;
        console.log("Row count: ", this.workBook[sheet].rows.length);
        console.log("Col count: ", this.workBook[sheet].columns.length);
        console.log("RangeIndicies: ", rangeIndices);
        if (rangeIndices.fromRow >= rowCount ||
            rangeIndices.toRow >= rowCount)
            return {loadStatus: false, error: `Max row count is ${rowCount}`};

        // XXX: WHAT?
        if (rangeIndices.fromCol > columnCount ||
            rangeIndices.toCol > columnCount)
            return {loadStatus: false, error: `Max column count is ${columnCount}`};
            
        let hdrRow = this.workBook[sheet].rows[rangeIndices.fromRow];
        console.log("hdrRow: ", JSON.stringify(hdrRow, null, 4));
        let hdrs = {}, hdrErrors = {}, loadStatus = true;
        for (let j = rangeIndices.fromCol; j <= rangeIndices.toCol; j++) {
            //hdrs[hdrRow[j]] = j;
            // column index to header string, final.
            hdrs[j] = hdrRow[j];
            if (/\./.test(hdrRow[j])) {
                hdrErrors[hdrRow[j]] = "Can't have . in header";
                loadStatus = false;
            }
        }
        return { loadStatus, range, rangeIndices, hdrs, hdrErrors }
    }

    static async exportDataFromDbIntoXlsx (dsName, dsView, dsUser, fileName) {
        let dbAbstraction = new DbAbstraction();
        let dbRes = await dbAbstraction.find(dsName, "metaData", { _id: `view_${dsView}` }, {} );
        dbRes = dbRes[0];
        //console.log(dbRes.columns);
        let projection = {}, hdrs = [], columnKeys = Object.keys(dbRes.columns);
        for (let i = 0; i < columnKeys.length; i++) {
            let column = dbRes.columns[columnKeys[i]]; 
            projection[ column ] = 1;
            let hdr = { header: column, key: column, width: 15 };
            hdrs.push(hdr);
        }
        console.log("Hdrs: ", hdrs, "Projection: ", projection);
        let data = await dbAbstraction.find (dsName, "data", {}, { projection } );
        console.log(data);
        // Export logic
        const workbook = new Excel.Workbook();
        const worksheet = workbook.addWorksheet("Data");
        worksheet.columns = hdrs;
        data.map((v) => {
            worksheet.addRow(v);
        })
        // https://stackoverflow.com/questions/181596/how-to-convert-a-column-number-e-g-127-into-an-excel-column-e-g-aa
        function translateIdToColumn (id) {
            let code = '';
            while (id) {
                let r = (id - 1) % 26;
                code = `${String.fromCharCode(65 + r)}${code}`
                id = Math.trunc((id - r)/26);
            }
            return code;
        }
        let cellAddr;
        for (let i = 0; i < columnKeys.length; i++) {
            cellAddr = translateIdToColumn(columnKeys[i]);
            cellAddr += "1"
            worksheet.getCell(cellAddr).fill = { type: 'pattern', pattern: 'solid', fgColor: {argb: 'FF8b8b00'}, /*bgColor: {argb: '800000FF'}*/};
        }
        let hdrRange = `A1:${cellAddr}`
        worksheet.autoFilter = hdrRange;
        worksheet.getRow(1).font = { name: 'Calibri', family: 4, size: 11, bold: true };

        const viewSheet = workbook.addWorksheet(`view_${dsView}`);
        viewSheet.getCell("A1").value = JSON.stringify(dbRes, null, 4);

        const descSheet = workbook.addWorksheet(`dsDescription`);
        let dsDesc = await dbAbstraction.find(dsName, "metaData", { _id: `dsDescription` }, {} );
        dsDesc = dsDesc[0];
        descSheet.getCell("A1").value = JSON.stringify(dsDesc, null, 4);

        const otherSheet = workbook.addWorksheet(`otherTableAttrs`);
        let other = await dbAbstraction.find(dsName, "metaData", { _id: `otherTableAttrs` }, {} );
        other = other[0];
        otherSheet.getCell("A1").value = JSON.stringify(other, null, 4);

        const filterSheet = workbook.addWorksheet(`filters`);
        let filters = await dbAbstraction.find(dsName, "metaData", { _id: `filters` }, {} );
        filters = filters[0];
        filterSheet.getCell("A1").value = JSON.stringify(filters, null, 4);

        const aclSheet = workbook.addWorksheet(`aclConfig`);
        let aclConfig = await dbAbstraction.find(dsName, "metaData", { _id: `aclConfig` }, {} );
        aclConfig = aclConfig[0];
        aclSheet.getCell("A1").value = JSON.stringify(aclConfig, null, 4);

        await workbook.xlsx.writeFile(fileName);
        await dbAbstraction.destroy();
    }

    async loadDataIntoDb (sheet, range, hdrs, keys, dsName, dsUser) {
        await this.init();
        if (!this.workBook[sheet])
            return { loadStatus: false, error: 'Sheet not found' };
        console.log(`Sheet is: ${sheet}, range is: ${range}`);
        let rangeIndices = this.getRangeIndices(range);

        if (!rangeIndices.status)
            return { loadStatus: false, error: 'Bad range' };
        if (rangeIndices.fromRow > rangeIndices.toRow || 
            rangeIndices.fromCol > rangeIndices.toCol)
            return { loadStatus: false, error: 'Invalid range' };
        
        let rowCount = this.workBook[sheet].rows.length;
        let columnCount = this.workBook[sheet].columns.length;
        if (rangeIndices.fromRow >= rowCount ||
            rangeIndices.toRow >= rowCount)
            return {loadStatus: false, error: `Max row count is ${rowCount}`};

        // XXX: WHAT?
        if (rangeIndices.fromCol > columnCount ||
            rangeIndices.toCol > columnCount)
            return {loadStatus: false, error: `Max column count is ${columnCount}`};
    
    
        let dbAbstraction = new DbAbstraction();
        // Check if db already exists...
        let dbList = await dbAbstraction.listDatabases();
        for (let i = 0; i < dbList.length; i++) {
            if (dbList[i].name === dsName) {
                console.log('Dataset name conflict');
                return { loadStatus: false, error: 'Dataset name conflict' }
            }
        }
        // Construct reverse map. header string to column index.
        let hdrsRev = {};
        Object.entries(hdrs).map((kv) => {
            hdrsRev[kv[1]] = kv[0];
        })
        for (let i = rangeIndices.fromRow + 1; i <= rangeIndices.toRow; i++) {
            let rowObjForDb = {};
            let row = this.workBook[sheet].rows[i];
            for (let j = rangeIndices.fromCol; j <= rangeIndices.toCol; j++) {
                rowObjForDb[hdrs[j]] = row[j];
            }
            let rowSelectorObj = {};
            keys.map((k) => {
                rowSelectorObj[k] = row[hdrsRev[k]];
            })
            console.log(`rowObjForDb: ${JSON.stringify(rowObjForDb, null, 4)}`)
            console.log(`rowSelectorObj: ${JSON.stringify(rowSelectorObj, null, 4)}`);
            try {
                await dbAbstraction.update(dsName, "data", rowSelectorObj, rowObjForDb);
            } catch (e) {
                console.log("Db update error: ", e);
            }
        }
        // Load metaDeta
        try {
            await dbAbstraction.update(dsName, "metaData", { _id: "perms" }, { owner: dsUser });
            await dbAbstraction.update(dsName, "metaData", { _id: "keys" }, { keys });
            if (this.wBook.getWorksheet("view_default")) {
                let value = this.wBook.getWorksheet("view_default").getCell("A1").value;
                value = JSON.parse(value);
                delete value._id;
                await dbAbstraction.update(dsName, "metaData", { _id: "view_default" }, value);
            } else {
                let columnAttrs = [];
                for (let i = rangeIndices.fromCol; i <= rangeIndices.toCol; i++) {
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
                }
                await dbAbstraction.update(dsName, "metaData", { _id: `view_default` }, { columns: hdrs, columnAttrs, userColumnAttrs: { } } );
            }
            if (this.wBook.getWorksheet("dsDescription")) {
                let value = this.wBook.getWorksheet("dsDescription").getCell("A1").value;
                value = JSON.parse(value);
                delete value._id;
                await dbAbstraction.update(dsName, "metaData", { _id: "dsDescription" }, value);
            }
            if (this.wBook.getWorksheet("otherTableAttrs")) {
                let value = this.wBook.getWorksheet("otherTableAttrs").getCell("A1").value;
                value = JSON.parse(value);
                delete value._id;
                await dbAbstraction.update(dsName, "metaData", { _id: "otherTableAttrs" }, value);
            }
            if (this.wBook.getWorksheet("filters")) {
                let value = this.wBook.getWorksheet("filters").getCell("A1").value;
                value = JSON.parse(value);
                delete value._id;
                await dbAbstraction.update(dsName, "metaData", { _id: "filters" }, value);
            }
            if (this.wBook.getWorksheet("aclConfig")) {
                let value = this.wBook.getWorksheet("aclConfig").getCell("A1").value;
                value = JSON.parse(value);
                delete value._id;
                await dbAbstraction.update(dsName, "metaData", { _id: "aclConfig" }, value);
            }
        } catch (e) {
            console.log("Db metaData update error: ", e)
        }
        await dbAbstraction.destroy();
        return { loadStatus: true, range, rangeIndices, hdrs }
    }

    async bulkUpdateDataIntoDb (sheet, range, hdrs, keys, dsName, dsUser) {
        await this.init();
        if (!this.workBook[sheet])
            return { loadStatus: false, error: 'Sheet not found' };
        console.log(`Sheet is: ${sheet}, range is: ${range}`);
        let rangeIndices = this.getRangeIndices(range);

        if (!rangeIndices.status)
            return { loadStatus: false, error: 'Bad range' };
        if (rangeIndices.fromRow > rangeIndices.toRow || 
            rangeIndices.fromCol > rangeIndices.toCol)
            return { loadStatus: false, error: 'Invalid range' };
        
        let rowCount = this.workBook[sheet].rows.length;
        let columnCount = this.workBook[sheet].columns.length;
        if (rangeIndices.fromRow >= rowCount ||
            rangeIndices.toRow >= rowCount)
            return {loadStatus: false, error: `Max row count is ${rowCount}`};

        // XXX: WHAT?
        if (rangeIndices.fromCol > columnCount ||
            rangeIndices.toCol > columnCount)
            return {loadStatus: false, error: `Max column count is ${columnCount}`};
    
    
        let dbAbstraction = new DbAbstraction();
        // Construct reverse map. header string to column index.
        let hdrsRev = {};
        Object.entries(hdrs).map((kv) => {
            hdrsRev[kv[1]] = kv[0];
        })
        for (let i = rangeIndices.fromRow + 1; i <= rangeIndices.toRow; i++) {
            let rowObjForDb = {};
            let row = this.workBook[sheet].rows[i];
            for (let j = rangeIndices.fromCol; j <= rangeIndices.toCol; j++) {
                rowObjForDb[hdrs[j]] = row[j];
            }
            let rowSelectorObj = {};
            keys.map((k) => {
                rowSelectorObj[k] = row[hdrsRev[k]];
            })
            console.log(`rowObjForDb: ${JSON.stringify(rowObjForDb, null, 4)}`)
            console.log(`rowSelectorObj: ${JSON.stringify(rowSelectorObj, null, 4)}`);
            try {
                await dbAbstraction.update(dsName, "data", rowSelectorObj, rowObjForDb);
            } catch (e) {
                console.log("Db update error: ", e);
            }
        }
        await dbAbstraction.destroy();
        return { loadStatus: true, range, rangeIndices, hdrs }
    }



}

module.exports = ExcelUtils;