import { useSite } from "../lib/site-context";
export default function useSiteSettings() { return useSite()?.settings || {}; }
