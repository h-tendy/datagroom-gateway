//const { resolve } = require('path');
const { readdir } = require('fs').promises;
const { stat } = require('fs').promises;
const DbAbstraction = require('./dbAbstraction');

async function getFiles(dir) {
  const dirents = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(dirents.map((dirent) => {
    //const res = resolve(dir, dirent.name);
    const res = dir + '/' + dirent.name;
    return dirent.isDirectory() ? getFiles(res) : res;
  }));
  return Array.prototype.concat(...files);
}

async function refreshAttachmentsIntoDbForOne(dsName) {
    let dbAbstraction = new DbAbstraction();
    try {
        //let dir = path.resolve(__dirname, `./attachments/${dbList[i].name}`);
        let dir = `attachments/${dsName}`;
        let files = await getFiles(dir);
        console.log(`Files under: ${dir}`);
        for (let j = 0; j < files.length; j++) {
            let stats = await stat(files[j]);
            let rec = {};
            //rec._id = files[j].replace(`${dir}/`, "");
            rec._id = files[j];
            rec.size = stats.size;
            rec.time = stats.ctimeMs;
            let insertResp = await dbAbstraction.insertOne(dsName, "attachments", rec);
            console.log('attachment insert response: ', insertResp);
            //console.log(`  ${files[j]}, ${stats.size}, ${stats.ctimeMs}`);
        }
    } catch (e) { console.log(e) }
    await dbAbstraction.destroy();
}

async function refreshAttachmentsIntoDb() {
    let dbAbstraction = new DbAbstraction();
    let dbList = await dbAbstraction.listDatabases();
    let sysDbs = ['admin', 'config', 'local'];
    for (let i = 0; i < dbList.length; i++) {
        let j = sysDbs.indexOf(dbList[i].name);
        if (j > -1)
            continue;
        try {
            await dbAbstraction.deleteTable(dbList[i].name, "attachments");
        } catch (e) {}
        await refreshAttachmentsIntoDbForOne(dbList[i].name);
    }
    await dbAbstraction.destroy();
}

module.exports = {
    refreshAttachmentsIntoDb,
    refreshAttachmentsIntoDbForOne
}