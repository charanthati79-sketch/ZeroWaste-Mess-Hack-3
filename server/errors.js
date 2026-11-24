"use strict";
// One error type for every expected failure. The central handler in app.js turns it into a JSON response.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = {
  HttpError,
  badRequest: msg => new HttpError(400, msg),
  forbidden: msg => new HttpError(403, msg),
  notFound: msg => new HttpError(404, msg),
  conflict: msg => new HttpError(409, msg),
};
