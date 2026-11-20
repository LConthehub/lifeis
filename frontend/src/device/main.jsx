/**
 * Where the on-device app starts. The same pages as always (App), with one difference made here: their
 * requests are answered inside the app (answer.js) from a database on the device (database.js), instead of
 * travelling to a server.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import axios, { AxiosError } from 'axios';
import { migrate } from '../../../core/src/index.ts';
import App from '../App';
import '../index.css';
import { deviceAnswers } from './answer.js';
import { openDeviceDatabase } from './database.js';

const root = ReactDOM.createRoot(document.getElementById('root'));

async function start() {
  const { db, saved } = await openDeviceDatabase();
  await migrate(db);
  const answer = await deviceAnswers(db);

  // Every request the pages make with axios comes here instead of going out.
  axios.defaults.adapter = async (config) => {
    const address = axios.getUri(config);
    let body = config.data;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const got = await answer((config.method ?? 'get').toUpperCase(), address, body);
    const response = { data: got.data, status: got.status, statusText: '', headers: got.headers, config, request: null };
    if (got.status >= 200 && got.status < 300) return response;
    throw new AxiosError(`Request failed with status code ${got.status}`, got.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, null, response);
  };
  // For trying it out: lets a test wait until what was written is kept.
  window.lifeisDevice = { saved };
  root.render(<React.StrictMode><App /></React.StrictMode>);
}

start().catch((problem) => {
  console.error(problem);
  root.render(<p style={{ padding: 24, fontFamily: 'sans-serif' }}>Life Is couldn't open its database on this device. {String(problem?.message ?? problem)}</p>);
});
