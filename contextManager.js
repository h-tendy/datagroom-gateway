const { AsyncLocalStorage } = require('async_hooks');

class RequestContext {
    constructor() {
        this.asyncLocalStorage = new AsyncLocalStorage();
    }

    // Set request context
    run(requestId, callback) {
        const context = { requestId };
        return this.asyncLocalStorage.run(context, callback);
    }

    // Get current request context
    getContext() {
        return this.asyncLocalStorage.getStore();
    }

    // Get current requestId
    getRequestId() {
        const context = this.getContext();
        return context ? context.requestId : null;
    }
}

module.exports = new RequestContext();