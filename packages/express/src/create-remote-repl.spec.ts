import express from 'express';
import { createRemoteRepl } from './create-remote-repl';
import { describeCreateRemoteRepl } from '../test/create-remote-repl.suite';

// Express 5 leg (the devDependency). The Express 4 leg is
// create-remote-repl.express4.spec.ts; both run ../test/create-remote-repl.suite.ts.
describeCreateRemoteRepl('express 5', express, createRemoteRepl, 5);
