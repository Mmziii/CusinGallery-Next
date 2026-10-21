import { useSite } from "../lib/site-context";
import { DEFAULT_CONTENT } from "../content/defaults";
export default function useSiteContent() { return useSite()?.content || DEFAULT_CONTENT; }
