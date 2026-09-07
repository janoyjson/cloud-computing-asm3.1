#!/usr/bin/env node
import { App } from 'aws-cdk-lib';

import { CloudSentinelStack } from '../lib/cloudsentinel-stack.js';

const app = new App();

new CloudSentinelStack(app, 'CloudSentinelFoundationStack');

