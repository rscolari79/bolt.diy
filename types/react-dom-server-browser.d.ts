/**
 * @types/react-dom 18 exposes only `./server` in its exports map, but at runtime
 * under Node `react-dom/server` resolves to server.node.js, which does NOT export
 * renderToReadableStream. The browser entry does, and works in Node 22 because
 * Web Streams are global there. This declaration gives the browser entry the
 * same types as `react-dom/server`.
 */
declare module 'react-dom/server.browser' {
  export * from 'react-dom/server';
}
