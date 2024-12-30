// @ts-check
const DbAbstraction = require('./dbAbstraction');
const Utils = require('./utils');
const MongoFilters = require('./routes/mongoFilters');

async function checkAccessForSpecificRow(dsName, dsView, dsUser, _id) {
    let dbAbstraction = new DbAbstraction();
    // per-row access control check. 
    let qFilters = [{ field: "_id", type: "eq", value: _id }];
    qFilters = await enforcePerRowAcessCtrl(dsName, dsView, dsUser, qFilters);
    let [filters, sorters] = MongoFilters.getMongoFiltersAndSorters(qFilters, null, null);
    let recs = await dbAbstraction.find(dsName, "data", filters, {});
    return recs;
}

async function enforcePerRowAcessCtrl(dsName, dsView, dsUser, filters) {
    let dbAbstraction = new DbAbstraction();
    try {
        let perRowAccessConfig = await dbAbstraction.find(dsName, "metaData", { _id: `perRowAccessConfig` }, {} );
        perRowAccessConfig = perRowAccessConfig[0];
        console.log("In enforcePerRowAccessCtrl, config is: ", perRowAccessConfig);
        if (!perRowAccessConfig) {
            await dbAbstraction.destroy();            
            return filters
        }
        if (!perRowAccessConfig.enabled) {
            await dbAbstraction.destroy();
            return filters
        }
        if (!perRowAccessConfig.column) {
            await dbAbstraction.destroy();
            return filters
        }
        console.log("In enforcePerRowAccessCtrl, User is: ", dsUser);
        if (filters) {
            let found = false;
            for (let i = 0; i < filters.length; i++) {
                let filter = filters[i]; 
                if (filter.field == perRowAccessConfig.column) {
                    filter.value = filter.value + `&&\\b${dsUser}\\b`
                    found = true;
                    break;
                }
            }
            if (!found) {
                filters.push({ field: perRowAccessConfig.column, type: 'like', value: `\\b${dsUser}\\b`})
            }
        } else {
            filters = [];
            filters.push({ field: perRowAccessConfig.column, type: 'like', value: `\\b${dsUser}\\b`})
        }
    } catch (e) {
        console.log("In perRowAccessCheck, exception: ", e);
    }
    await dbAbstraction.destroy();
    return filters;
}

module.exports = {
    checkAccessForSpecificRow,
    enforcePerRowAcessCtrl
};