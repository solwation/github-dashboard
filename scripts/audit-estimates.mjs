// Read-only GitHub audit. Raw issue content stays in memory; stdout contains aggregates only.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import ts from 'typescript';

const exec = promisify(execFile);
async function graphql(query, variables = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) args.push('-F', `${key}=${value ?? 'null'}`);
  const { stdout } = await exec('gh', args, { maxBuffer: 32 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (result.errors) throw new Error(JSON.stringify(result.errors));
  return result.data;
}
const eventFields = `pageInfo {hasNextPage endCursor} nodes {
  __typename
  ... on LabeledEvent { createdAt label {name} }
  ... on UnlabeledEvent { createdAt label {name} }
  ... on ClosedEvent { createdAt }
  ... on ReopenedEvent { createdAt }
}`;
const events = `timelineItems(first:30, itemTypes:[LABELED_EVENT, UNLABELED_EVENT, CLOSED_EVENT, REOPENED_EVENT]) {${eventFields}}`;
const query = `query($owner:String!, $name:String!, $cursor:String) { repository(owner:$owner,name:$name) {
 issues(first:50,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}) { totalCount pageInfo {hasNextPage endCursor} nodes {
 databaseId number title body state createdAt updatedAt closedAt labels(first:100) {nodes {name color} pageInfo {hasNextPage}} ${events}
 } } } rateLimit {remaining} }`;
const baselineRef = process.env.ESTIMATE_AUDIT_BASELINE_REF;
const baselineSource = baselineRef ? (await exec('git', ['show', `${baselineRef}:src/lib/story-points.ts`])).stdout : null;
const baselineUrl = baselineSource ? `data:text/javascript;base64,${Buffer.from(ts.transpileModule(baselineSource, {
  compilerOptions: {module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText).toString('base64')}` : null;
const server = await createServer({server:{middlewareMode:true,hmr:false}, logLevel:'error'});
try {
  const {approximatePoints, storyPoints} = baselineUrl ? await import(baselineUrl) : await server.ssrLoadModule('/src/lib/story-points.ts');
  const {closedWorkStart, isCoordination} = await server.ssrLoadModule('/src/lib/model.ts');
  const {median} = await server.ssrLoadModule('/src/lib/estimates.ts');
  const repos = process.argv.slice(2);
  if (!repos.length) throw new Error('Usage: node scripts/audit-estimates.mjs owner/repository [...]');
  for (const repository of repos) {
    const [owner,name] = repository.split('/');
    let cursor = null, issues = [], rateRemaining;
    do {
      const data = await graphql(query, {owner,name,cursor});
      rateRemaining = data.rateLimit.remaining;
      const page = data.repository.issues;
      for (const node of page.nodes) {
        const raw = [...node.timelineItems.nodes];
        let extra = node.timelineItems.pageInfo;
        while (extra.hasNextPage) {
          const data = await graphql(`query($owner:String!,$name:String!,$number:Int!,$cursor:String) {
            repository(owner:$owner,name:$name) {issue(number:$number) {
              timelineItems(first:100,after:$cursor,itemTypes:[LABELED_EVENT,UNLABELED_EVENT,CLOSED_EVENT,REOPENED_EVENT]) {${eventFields}}
            }} }`, {owner,name,number:node.number,cursor:extra.endCursor});
          const page = data.repository.issue.timelineItems;
          raw.push(...page.nodes); extra = page.pageInfo;
        }
        if (node.labels.pageInfo.hasNextPage) throw new Error('Issue has more than 100 labels; refusing incomplete sizing');
        const issue = {id:node.databaseId, number:node.number,title:node.title,body:node.body,state:node.state.toLowerCase(),
          created_at:node.createdAt,updated_at:node.updatedAt,closed_at:node.closedAt,labels:node.labels.nodes,assignees:[]};
        const eventNames = {LabeledEvent:'labeled',UnlabeledEvent:'unlabeled',ClosedEvent:'closed',ReopenedEvent:'reopened'};
        const timeline = raw.map((e,index)=>({id:index,event:eventNames[e.__typename],created_at:e.createdAt,label:e.label}));
        issue.workStartedAt = closedWorkStart(timeline,issue.closed_at);
        issues.push({issue,timeline});
      }
      process.stderr.write(`${repository}: ${issues.length}/${page.totalCount} issues; GraphQL remaining ${rateRemaining}\n`);
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while(cursor);
    const closed = issues.filter(({issue})=>issue.state==='closed' && !isCoordination(issue));
    const samples = closed.flatMap(({issue,timeline})=>{
      const startedMs=Date.parse(issue.workStartedAt),closedMs=Date.parse(issue.closed_at);
      if (!(closedMs>startedMs)) return [];
      return [{issue,startedMs,closedMs,durationMs:closedMs-startedMs,points:approximatePoints(issue),explicit:storyPoints(issue).source==='label',
        reopened:timeline.some(e=>e.event==='reopened'),labelRemoved:timeline.some(e=>e.event==='unlabeled' && e.created_at>issue.workStartedAt && e.created_at<issue.closed_at)}];
    }).sort((a,b)=>a.closedMs-b.closedMs || a.issue.id-b.issue.id);
    // Forecast at work start using strictly earlier durations, with current sizing content.
    const variants = {
      current:s=>s.points,
      flat:()=>1,
      compressed:s=>s.explicit?s.points:Math.sqrt(s.points),
      capped3:s=>s.explicit?s.points:Math.min(3,s.points),
      capped5:s=>s.explicit?s.points:Math.min(5,s.points),
      gentle:s=>s.explicit?s.points:({1:1,2:2,3:2,5:3,8:3,13:5}[s.points]),
      compact:s=>s.explicit?s.points:({1:1,2:1,3:2,5:2,8:3,13:5}[s.points]),
      recent10:s=>s.points,
      recent10Cap3:s=>s.explicit?s.points:Math.min(3,s.points),
      untrimmed:s=>s.points,
      cap3Untrimmed:s=>s.explicit?s.points:Math.min(3,s.points),
    };
    const rows = [];
    for (const target of samples) {
      const history = samples.filter(s=>s.closedMs<target.startedMs && s.closedMs>=target.startedMs-30*86400000).slice(-30);
      const predictions = {};
      for (const [variant,size] of Object.entries(variants)) {
        const rates=(variant.startsWith("recent10")?history.slice(-10):history).map(s=>s.durationMs/size(s)),center=median(rates);
        const retained = variant.toLowerCase().includes("untrimmed") ? rates : rates.filter(r=>r<=center*4);
        if(retained.length>=3) predictions[variant]=median(retained)*size(target);
      }
      if (Object.keys(predictions).length!==Object.keys(variants).length) continue;
      const numeric={actual:target.durationMs,points:target.points,explicit:target.explicit};
      for(const [key,value] of Object.entries(predictions))numeric[key]=value;
      rows.push(numeric);
    }
    const score = subset => Object.fromEntries(Object.keys(variants).map(key=>[key,{
      medianFactor:subset.length?Number(Math.exp(median(subset.map(r=>Math.abs(Math.log(r.actual/r[key]))))).toFixed(3)):null,
      within2Count:subset.filter(r=>r.actual/r[key]>=.5&&r.actual/r[key]<=2).length,
      within2:subset.length?Number((subset.filter(r=>r.actual/r[key]>=.5&&r.actual/r[key]<=2).length/subset.length*100).toFixed(1)):null,
      medianBiasPercent:subset.length?Number(((median(subset.map(r=>r.actual/r[key]))-1)*100).toFixed(1)):null,
    }]));
    const split=Math.floor(rows.length*.7);
    console.log(JSON.stringify({repository,baselineRef:baselineRef ?? 'working-tree',total:issues.length,closed:closed.length,knownStart:samples.length,explicit:samples.filter(s=>s.explicit).length,
      reopened:samples.filter(s=>s.reopened).length,labelRemovedBeforeClose:samples.filter(s=>s.labelRemoved).length,
      points:[1,2,3,5,8,13].map(points=>{const s=samples.filter(s=>s.points===points);return {points,count:s.length,medianMinutes:median(s.map(s=>s.durationMs/60000))};}),
      evaluated:rows.length,development:score(rows.slice(0,split)),holdoutCount:rows.length-split,holdout:score(rows.slice(split))}));
    // Aggregated numeric observations only: no titles, bodies, issue IDs or event snapshots.
  }
} finally { await server.close(); }
