const XperteaseUtils = require('./dgApiUtils');
async function test() {
    let dsName = `Dsim_backlog`;
    // set the selectonObj as per your test case. 
    let selectorObj = {};
    selectorObj["Sl No"] = `Test-row-4`
    let doc = {};
    doc["Sl No"] = `Test-row-3`;
    doc.Owners = `90%`;
    doc.Tags = `80%`;
    await XperteaseUtils.pushRowToDG(dsName, selectorObj, doc);
 
}
test();
 