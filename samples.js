const DgApiUtils = require('./dgApiUtils');
const Locks = require('./locks')
async function test() {
    let dsName = `Dsim_backlog`;
    // set the selectonObj as per your test case. 
    let selectorObj = {};
    selectorObj["Sl No"] = `Test-row-4`
    let doc = {};
    doc["Sl No"] = `Test-row-3`;
    doc.Owners = `90%`;
    doc.Tags = `80%`;
    await DgApiUtils.pushRowToDG(dsName, selectorObj, doc);
 
}
// Uncomment to test api.
//test();

// Sample usage of Locks. 
async function lockTest() {
    await Locks.lock("SomeKey");
    // Do something here. 
    Locks.unlock("SomeKey");
}

