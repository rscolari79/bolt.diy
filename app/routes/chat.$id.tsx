import type { LoaderFunctionArgs } from '@remix-run/node';
import { default as IndexRoute } from './_index';

export async function loader(args: LoaderFunctionArgs) {
  return Response.json({ id: args.params.id });
}

export default IndexRoute;
