import S3 from 'aws-sdk/clients/s3';
import uuid4 from 'uuid/v4';
import * as utils from './lib/api_utils';
import { loadContextFromHeader, touch, buildAttachmentDocument } from './lib/bitwarden';
import { mapCipher } from './lib/mappers';
import { Cipher } from './lib/models';
import { parseMultipart } from './lib/multipart';

export const postHandler = async (event, context, callback) => {
  console.log('Attachment create handler triggered', JSON.stringify(event, null, 2));

  if (!event.body) {
    callback(null, utils.validationError('Request body is missing'));
    return;
  }

  const multipart = parseMultipart(event);
  if (!multipart.data) {
    callback(null, utils.validationError('File data is missing'));
    return;
  }

  let user;
  try {
    ({ user } = await loadContextFromHeader(event.headers.Authorization));
  } catch (e) {
    callback(null, utils.validationError('User not found: ' + e.message));
    return;
  }

  const cipherUuid = event.pathParameters.uuid;
  if (!cipherUuid) {
    callback(null, utils.validationError('Missing vault item ID'));
  }

  try {
    let cipher = await Cipher.getAsync(user.get('uuid'), cipherUuid);

    if (!cipher) {
      callback(null, utils.validationError('Unknown vault item'));
      return;
    }

    const part = multipart.data;
    part.id = uuid4();
    const params = {
      ACL: 'public-read',
      Body: part.content,
      Bucket: process.env.ATTACHMENTS_BUCKET,
      Key: cipherUuid + '/' + part.id,
    };

    const s3 = new S3();
    await new Promise((resolve, reject) =>
      s3.putObject(params, (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      }));

    cipher.get('attachments').push(buildAttachmentDocument(part));

    cipher = await cipher.updateAsync();
    await touch(user);

    callback(null, utils.okResponse(await mapCipher(cipher)));
  } catch (e) {
    callback(null, utils.serverError('Server error saving vault item', e));
  }
};

export const deleteHandler = async (event, context, callback) => {
  console.log('Attachment create handler triggered', JSON.stringify(event, null, 2));

  let user;
  try {
    ({ user } = await loadContextFromHeader(event.headers.Authorization));
  } catch (e) {
    callback(null, utils.validationError('User not found: ' + e.message));
    return;
  }
  const cipherUuid = event.pathParameters.uuid;
  const { attachmentId } = event.pathParameters;

  try {
    let cipher = await Cipher.getAsync(user.get('uuid'), cipherUuid);

    if (!cipher) {
      callback(null, utils.validationError('Unknown vault item'));
      return;
    }

    const params = {
      Bucket: process.env.ATTACHMENTS_BUCKET,
      Key: cipherUuid + '/' + attachmentId,
    };

    const s3 = new S3();
    await new Promise((resolve, reject) =>
      s3.deleteObject(params, (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      }));

    cipher.set({
      attachments: cipher.get('attachments').filter(a => a.uuid !== attachmentId),
    });

    cipher = await cipher.updateAsync();
    await touch(user);

    callback(null, utils.okResponse(''));
  } catch (e) {
    callback(null, utils.serverError('Server error deleting vault attachment', e));
  }
};