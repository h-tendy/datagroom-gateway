const DbAbstraction = require('./dbAbstraction');
const Utils = require('./utils');
const logger = require('./logger');

/**
 * Check whether a user has access to a dataset.
 * Authentication is handled upstream by the authenticate middleware which sets req.user.
 * token and authMethod parameters are accepted for backward compatibility but ignored.
 */
async function aclCheck(dsName, dsView, dsUser, token = null, authMethod = null) {
    let dbAbstraction = new DbAbstraction();
    try {
        let aclConfig = await dbAbstraction.find(dsName, "metaData", { _id: "aclConfig" }, {});
        aclConfig = aclConfig[0];
        if (!aclConfig) {
            return true;
        }
        if (!aclConfig.accessCtrl) {
            return true;
        }
        logger.info(`ACL check for user: ${dsUser}, dataset: ${dsName}`);
        if (dsUser && aclConfig.acl && aclConfig.acl.includes(dsUser)) {
            logger.info(`User ${dsUser} granted access to dataset: ${dsName}`);
            return true;
        }
        if (!dsUser) {
            logger.warn('No user provided in ACL check');
        } else {
            logger.warn(`User ${dsUser} denied access to dataset: ${dsName}`);
        }
    } catch (e) {
        logger.error(e, "Exception in aclCheck");
    }
    return false;
}

module.exports = {
    aclCheck
};
