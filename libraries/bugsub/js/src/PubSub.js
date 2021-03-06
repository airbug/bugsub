/*
 * Copyright (c) 2014 airbug Inc. All rights reserved.
 *
 * All software, both binary and source contained in this work is the exclusive property
 * of airbug Inc. Modification, decompilation, disassembly, or any other means of discovering
 * the source code of this software is prohibited. This work is protected under the United
 * States copyright law and other international copyright treaties and conventions.
 */


//-------------------------------------------------------------------------------
// Annotations
//-------------------------------------------------------------------------------

//@Export('bugsub.PubSub')
//@Autoload

//@Require('Class')
//@Require('Flows')
//@Require('List')
//@Require('Map')
//@Require('Obj')
//@Require('UuidGenerator')
//@Require('bugsub.Message')
//@Require('bugsub.Subscriber')
//@Require('redis.RedisPubSub')


//-------------------------------------------------------------------------------
// Context
//-------------------------------------------------------------------------------

require('bugpack').context("*", function(bugpack) {

    //-------------------------------------------------------------------------------
    // BugPack
    //-------------------------------------------------------------------------------

    var Class                   = bugpack.require('Class');
    var Flows                   = bugpack.require('Flows');
    var List                    = bugpack.require('List');
    var Map                     = bugpack.require('Map');
    var Obj                     = bugpack.require('Obj');
    var UuidGenerator           = bugpack.require('UuidGenerator');
    var Message                 = bugpack.require('bugsub.Message');
    var Subscriber              = bugpack.require('bugsub.Subscriber');
    var RedisPubSub             = bugpack.require('redis.RedisPubSub');


    //-------------------------------------------------------------------------------
    // Declare Class
    //-------------------------------------------------------------------------------

    /**
     * @class
     * @extends {Obj}
     */
    var PubSub = Class.extend(Obj, {

        _name: "bugsub.PubSub",


        //-------------------------------------------------------------------------------
        // Constructor
        //-------------------------------------------------------------------------------

        /**
         * @constructs
         * @param {Marshaller} marshaller
         * @param {RedisPubSub} redisPubSub
         */
        _constructor: function(marshaller, redisPubSub) {

            this._super();


            //-------------------------------------------------------------------------------
            // Private Properties
            //-------------------------------------------------------------------------------

            /**
             * @private
             * @type {Map.<string, List.<Subscriber>>}
             */
            this.channelToSubscriberListMap             = new Map();

            /**
             * @private
             * @type {Marshaller}
             */
            this.marshaller                             = marshaller;

            /**
             * @private
             * @type {RedisPubSub}
             */
            this.redisPubSub                            = redisPubSub;
        },


        //-------------------------------------------------------------------------------
        // Getters and Setters
        //-------------------------------------------------------------------------------

        /**
         * @return {Marshaller}
         */
        getMarshaller: function() {
            return this.marshaller;
        },

        /**
         * @return {RedisPubSub}
         */
        getRedisPubSub: function() {
            return this.redisPubSub;
        },


        //-------------------------------------------------------------------------------
        // Public Methods
        //-------------------------------------------------------------------------------

        /**
         *
         */
        deinitialize: function() {
            this.redisPubSub.off(RedisPubSub.EventTypes.MESSAGE, this.hearMessageEvent, this);
        },

        /**
         * @param {string} channel
         * @return {boolean}
         */
        hasSubscriber: function(channel) {
            return this.channelToSubscriberListMap.containsKey(channel);
        },

        /**
         *
         */
        initialize: function() {
            this.redisPubSub.on(RedisPubSub.EventTypes.MESSAGE, this.hearMessageEvent, this);
        },

        /**
         * @param {string} channel
         * @param {(Message | *)} message
         * @param {function(Throwable, number=)} callback
         */
        publish: function(channel, message, callback) {
            if (!Class.doesExtend(message, Message)) {
                message = this.factoryMessage({
                    messageType: "message",
                    messageData: message
                });
            }
            this.preProcessMessage(message);
            this.doPublishMessage(channel, message, callback);
        },

        /**
         * @param {string} channel
         * @param {(Message | *)} message
         * @param {function(Message)} subscriberFunction
         * @param {Object} subscriberContext
         * @param {function(Throwable, number=)} callback
         */
        publishAndSubscribeToResponse: function(channel, message, subscriberFunction, subscriberContext, callback) {
            var _this = this;
            if (!Class.doesExtend(message, Message)) {
                message = this.factoryMessage({
                    messageType: "message",
                    messageData: message
                });
            }
            this.preProcessMessage(message);
            var responseChannel = this.generateResponseChannel(message);
            this.subscribeOnce(responseChannel, subscriberFunction, subscriberContext, function(throwable) {
                //TODO BRN: What to do if we get a throwable here?
                if (!throwable) {
                    _this.doPublishMessage(channel, message, callback);
                } else {
                    callback(throwable);
                }
            });
        },

        /**
         * @param {Message} respondingToMessage
         * @param {(Message | *)} message
         * @param {function(Throwable, number=)} callback
         */
        publishResponse: function(respondingToMessage, message, callback) {
            var responseChannel = this.generateResponseChannel(respondingToMessage);
            this.publish(responseChannel, message, callback);
        },

        /**
         * @param {string} channel
         * @param {function(Message)} subscriberFunction
         * @param {Object} subscriberContext
         * @param {function(Throwable=)} callback
         */
        subscribe: function(channel, subscriberFunction, subscriberContext, callback) {
            var subscriber = this.factorySubscriber(subscriberFunction, subscriberContext, false);
            this.addSubscriber(channel, subscriber, callback);
        },

        /**
         * @param {string} channel
         * @param {function(Message)} subscriberFunction
         * @param {Object} subscriberContext
         * @param {function(Throwable=)} callback
         */
        subscribeOnce: function(channel, subscriberFunction, subscriberContext, callback) {
            var subscriber = this.factorySubscriber(subscriberFunction, subscriberContext, true);
            this.addSubscriber(channel, subscriber, callback);
        },

        /**
         * @param {string} channel
         * @param {function(Message)} subscriberFunction
         * @param {Object} subscriberContext
         * @param {function(Throwable, boolean=)} callback
         */
        unsubscribe: function(channel, subscriberFunction, subscriberContext, callback) {
            var subscriber = this.factorySubscriber(subscriberFunction, subscriberContext, false);
            this.removeSubscriber(channel, subscriber, callback);
        },


        //-------------------------------------------------------------------------------
        // Protected Methods
        //-------------------------------------------------------------------------------

        /**
         * @protected
         * @param {string} channel
         * @param {Subscriber} subscriber
         * @param {function(Throwable=)} callback
         */
        addSubscriber: function(channel, subscriber, callback) {
            var subscriberList = this.channelToSubscriberListMap.get(channel);
            if (!subscriberList) {
                subscriberList = new List();
                this.channelToSubscriberListMap.put(channel, subscriberList);
            }
            subscriberList.add(subscriber);
            this.redisPubSub.subscribe(channel, callback);
        },

        /**
         * @protected
         * @param {string} messageString
         * @return {Message}
         */
        buildMessage: function(messageString) {
            return this.marshaller.unmarshalData(messageString);
        },

        /**
         * @protected
         * @param {Message} message
         * @param {string} channel
         */
        deliverMessage: function(message, channel) {
            var _this = this;
            var subscriberList  = this.channelToSubscriberListMap.get(channel);
            if (subscriberList) {
                subscriberList.forEach(function(subscriber) {
                    subscriber.receiveMessage(message, channel);
                    if (subscriber.getOnce()) {
                        _this.removeSubscriber(channel, subscriber, function(throwable) {
                            if (throwable) {
                                console.log(throwable);
                            }
                        });
                    }
                });
            } else {
                //TODO BRN: If there are no subscribers for this message, what do we do?
                console.warn("No subscribers to receive message on channel:", channel);
            }
        },

        /**
         * @protected
         * @param {string} channel
         * @param {Message} message
         * @param {function(Throwable, number=)} callback
         */
        doPublishMessage: function(channel, message, callback) {
            var messageString = this.unbuildMessage(message);
            this.redisPubSub.publish(channel, messageString, callback);
        },

        /**
         * @protected
         * @param {{messageType: string, messageData: *, messageUuid: string=}} messageObject
         * @return {Message}
         */
        factoryMessage: function(messageObject) {
            var message = new Message(messageObject.messageType, messageObject.messageData);
            if (messageObject.messageUuid) {
                message.setMessageUuid(messageObject.messageUuid);
            }
            return message;
        },

        /**
         * @protected
         * @param {function(Message)} subscriberFunction
         * @param {Object} subscriberContext
         * @param {boolean} once
         * @return {Subscriber}
         */
        factorySubscriber: function(subscriberFunction, subscriberContext, once) {
            return new Subscriber(subscriberFunction, subscriberContext, once);
        },

        /**
         * @protected
         * @param {Message} message
         * @return {string}
         */
        generateResponseChannel: function(message) {
            return "response:" + message.getMessageUuid();
        },

        /**
         * @protected
         * @param {Message} message
         */
        preProcessMessage: function(message) {
            message.setMessageUuid(UuidGenerator.generateUuid());
        },

        /**
         * @protected
         * @param {string} channel
         * @param {Subscriber} subscriber
         * @param {function(Throwable, boolean=)} callback
         */
        removeSubscriber: function(channel, subscriber, callback) {
            var subscriberList = this.channelToSubscriberListMap.get(channel);
            if (subscriberList) {
                var result = subscriberList.remove(subscriber);
                if (result) {
                    if (subscriberList.getCount() === 0) {
                        this.channelToSubscriberListMap.remove(channel);
                        this.redisPubSub.unsubscribe(channel, function(throwable) {
                            if (!throwable) {
                                callback(null, true);
                            } else {
                                callback(throwable);
                            }
                        });
                    } else {
                        callback(null, true);
                    }
                } else {
                    callback(null, false);
                }
            } else {
                callback(null, false);
            }
        },

        /**
         * @protected
         * @param {Message} message
         * @return {string}
         */
        unbuildMessage: function(message) {
            return this.marshaller.marshalData(message);
        },


        //-------------------------------------------------------------------------------
        // Private Methods
        //-------------------------------------------------------------------------------

        /**
         * @private
         * @param {RedisMessage} redisMessage
         * @param {string} redisChannel
         */
        processRedisMessage: function(redisMessage, redisChannel) {
            var messageString   = redisMessage.getMessage();
            var message         = this.buildMessage(messageString);
            this.deliverMessage(message, redisChannel);
        },


        //-------------------------------------------------------------------------------
        // Event Listeners
        //-------------------------------------------------------------------------------

        /**
         * @private
         * @param event
         */
        hearMessageEvent: function(event) {
            var redisMessage = event.getData().redisMessage;
            var redisChannel = event.getData().redisChannel;
            this.processRedisMessage(redisMessage, redisChannel);
        }
    });


    //-------------------------------------------------------------------------------
    // Exports
    //-------------------------------------------------------------------------------

    bugpack.export('bugsub.PubSub', PubSub);
});
