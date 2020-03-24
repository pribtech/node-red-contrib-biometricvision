const Logger = require("node-red-contrib-logger");
const logger = new Logger("biometricvision");
logger.sendInfo("Copyright 2020 Jaroslav Peter Prib");

const hostURL='https://bvengine.com',
	compareURL=hostURL+'/api/compare',
	tokenURL=hostURL+'/oauth/token',
	request=require('request');

module.exports = function(RED) {
    function biometricCompareNode(config) {
        RED.nodes.createNode(this, config);
        let node=Object.assign(this,config);
        node.status({fill: "yellow", shape: "dot", text: "Awaiting request"});
//		node.reqTimeout = parseInt(RED.settings.httpRequestTimeout || 60000);
		node.getToken= function (msg) {
			if(msg.biometricvisionConnectTried) {
 				node.sendError(msg,"get token has be tried,in loop");
 				return;
			}
			if(logger.active) logger.send({label:"getToken",user:node.user});
			request.post({
		        url: tokenURL, 
		        json: {
					    "client_id": node.user,
						"client_secret": node.password,
						"grant_type": "client_credentials"
					}
		    }, function(error, response, body) {
//		    	if(node.logResponse) logger.send({label:"gettoken reponse",response:response});
              	if (error) {
 					node.sendError(msg,error);
                } else{
					if(logger.active) logger.send({label:"getToken response",user:node.user});
   					try{
   						node.connection = body;
   					} catch(e){
   						node.error(e);
   						logger.send({label:"sendCompare response",body:body});
   						node.sendError(msg,"gettoken unexpected error, response object parsing error");
   	 					return;
   	 				}
	        		node.status({fill: "green", shape: "dot"});
	        		msg.biometricvisionConnectTried=true;
	        		node.headers = {
    					'Authorization':'Bearer '+node.connection.access_token,
    					'X-API-KEY': '328a47240f46a0f20be631116ac56bd3',
   						'Content-Type': 'multipart/form-data'
   					};
					if(logger.active) logger.send({label:"getToken ok",response:node.connection});
	        		node.sendCompare(msg);
                }
			});
		};
		node.sendCompare=function (msg) {
			if(logger.active) logger.send({label:"sendCompare"});
			if(!node.connection){
        		node.getToken(msg);
        		return;
			}
			request.post({
		        url: compareURL, 
		        headers: node.headers,
 				form: {image1:msg.payload.image1,image2:msg.payload.image2}
		    }, function(error, response, body) {
//				logger.send({label:"sendCompare response",response:response});   response.statusCode == 200
				try{
					if(error) throw Error(error);
					if(response) throw Error('no response');
					if(response.statusCode !== 200) throw Error('statusCode: '+response.statusCode);
					msg.payload=body;
				} catch(e){
					node.error(e);
					logger.send({label:"sendCompare response",response:response});
					msg.payload=body;
					node.sendError(msg,"Unexpected error, response object parsing error");
					return;
   	 			}
				node.send(msg);
		    });
		};
		this.sendError= function(msg,error) {
				node.status({fill: "red",shape: "ring",text: error});
				node.warn(RED._("Error: "+error));
                msg.error = error;
                msg.statusCode = 400;
                node.send([null,null,msg]); 
		};
        node.on("input", function(msg) {
 			if(!msg.payload) {
 				node.sendError(msg,'message missing payload');
        	} else if(!msg.payload.image1) {
 				node.sendError(msg,'message payload missing property image1');
        	} else if(!msg.payload.image2) {
 				node.sendError(msg,'message payload missing property image2');
        	} else {
    			if(logger.active) logger.send({label:"input passed tests"});
            	node.sendCompare(msg);
        	}
        });
    } 

    RED.nodes.registerType("Biometric Compare", biometricCompareNode, {
        credentials: {
            user: {
                type: "text"
            },
            password: {
                type: "password"
            }
        }
    });

};