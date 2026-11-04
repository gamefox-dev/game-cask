// Publication happens only after Playwright has finished every test fixture teardown.
import type {Reporter,TestCase,TestResult} from '@playwright/test/reporter';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM private evidence publisher
import {publishCoverage} from '../../tools/build/coverage.mjs';
export default class CoverageEvidenceReporter implements Reporter {
  private root:string;
  constructor(options:{root?:string}={}) {this.root=options.root ?? process.cwd();}
  onTestEnd(test:TestCase,result:TestResult) {
    if(!test.parent.project()?.name.startsWith('port-')||test.expectedStatus!=='passed'||result.status!=='passed'||result.errors.length)return;
    for(const attachment of result.attachments)if(attachment.name==='coverage.json') {
      const bytes=attachment.body ?? (attachment.path?readFileSync(attachment.path):null);
      if(bytes)publishCoverage(this.root,JSON.parse(bytes.toString()));
    }
  }
}
