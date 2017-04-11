module.exports = RestTest;

var http = require("http");
var querystring = require("querystring");
var jsext = require("jsext");

function RestTest (options) {
    var self = this;
    self.options = Object.assign({}, RestTest.DEFAULTOPTIONS, options) || {};
    self.keepsession = self.options.keepsession != undefined ? self.options.keepsession : false;
    self.sessionCookie = null;
}


RestTest.prototype.DEFAULTOPTIONS = { 
    urlbase : "localhost", 
    port : 8080,
    timeout : 60000
};


RestTest.ERROR = {
    MISSING_PARAMS : "Missing function parameters",
    JSONPARSE : "Can not parse json data",
    SERVER_RESPONSE : "Internal server error",
    SERVER_COM : "Server communication error"
};


RestTest.prototype.setKeepSession = function (active)
{
    var self = this;
    self.keepsession = active;
}


RestTest.prototype.resetSession = function() 
{
    var self = this;
    self.sessionCookie = null;
}


/**
 * request
 * @param {Object} options : {
 *      method string Request method, default is GET
 *      path string Link to test
 *      data object Parameters dictionary ( key = value )
 * }
 * @return {Promise}
 */
RestTest.prototype.request = function (options) {
    var self = this;
    return new Promise(function(resolve, reject) {
        if(!options) return reject(new Error({error:RestTest.ERROR.MISSING_PARAMS}));

        var method = options.method || "GET";
        var path = options.path;
        var dataString = JSON.stringify(options.data);
        var info = {
            startTime : new Date(),
            requestData : options.data,
            request : {
                method : method,
                port : options.port || self.options.port,
                path : path || "/",
                hostname : options.hostname || self.options.urlbase,
                headers : {}
            }
        };
        if(method == "GET") {
            var query = querystring.stringify(options.data);
            info.request.path = jsext.buildUrl(path, query);
        } else if(method == "POST") {
            info.request.headers['Content-Type'] = 'application/json';
            info.request.headers['Connection'] = 'keep-alive';
            info.request.headers['Content-Length'] = dataString && dataString.length || 0;
            info.request.json = true;
        }

        if(self.keepsession) {
            if(self.sessionCookie) info.request.headers['Cookie'] = self.sessionCookie;
            info.request.headers["Connection"] = "keep-alive";
            info.request.agent = new http.Agent({
                maxSockets: 1,
                timeout: self.options.timeout,
                keepAliveTimeout: self.options.timeout
            });
        }

        var request = http.request(info.request, function(response) {
            var data = "";
            response.setEncoding('utf8');
            info.headers = response.headers;
            if(self.keepsession) {
                var cookie = response.headers["set-cookie"];
                self.sessionCookie = cookie && cookie.length > 0 && cookie[0] || self.sessionCookie;
            }
            response.on("data", function(d) {
                data += d;
            });
            response.on("end", function() {
                info.endTime = new Date();
                info.duration = info.endTime - info.startTime;
                info.statusCode = this.statusCode;
                info.statusMessage = this.statusMessage;
                if(info.statusCode != 200)
                    return reject({error:RestTest.ERROR.SERVER_RESPONSE, data:data, info:info});

                if(options.responseType && options.responseType == "json") {
                    try {
                        var parsed = JSON.parse(data);
                    } catch (err) {
                        return reject({error:RestTest.ERROR.JSONPARSE, err:err, info:info, data:data});
                    }
                }

                resolve({info:info, data:parsed || data});
            });
        }).on("error", function(error) {
            info.endTime = new Date();
            info.duration = info.endTime - info.startTime;

            reject({error:RestTest.ERROR.SERVER_COM, err:error, info:info});
        });

        if(dataString && method == "POST") {
            request.write(dataString);
        }

        request.end();
    });
}


/**
 * parcours
 * 
 * @param steps [Step] Step = {
 *      action function Step action
 *      params [arg] Step params to action without callback
 *      verify callback Returns true/false to validate from action : callback(err, info, data)
 * }
 * callback function Callback params ()
 */
RestTest.prototype.parcours = function (steps, callback, stepindex) {
    var self = this;
    stepindex = stepindex || 0;

    if(stepindex >= steps.length)
        return jsext.callback(callback, [null]);

    var step = steps[stepindex];
    if(!step || !step.action)
        return Log.error("Parcous step error");

    var params = step.params || [];
    params.push(function(err, info, data) {
        if(step.verify) {
            var verification = step.verify(err, info, data);
            if(!verification) return jsext.callback(callback, ["parcours step : " + stepindex]);
        }
        self.parcours(steps, callback, ++stepindex);
    });
    step.action.apply(self, params);
}