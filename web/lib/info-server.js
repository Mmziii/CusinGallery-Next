import { apiServer } from "./api-server";
import { isNotFound } from "./catalog-server";
import { normalizeApiError } from "../utils/apiError";

export const INFO_FALLBACK_TITLES = {
  about: "دربارهٔ ما",
  contact: "تماس با ما",
  "shipping-returns": "ارسال و مرجوعی",
  terms: "قوانین و مقررات",
  privacy: "حریم خصوصی",
};

export const INFO_PAGES = {
  about: "/about/",
  contact: "/contact/",
  "shipping-returns": "/shipping-returns/",
  terms: "/terms/",
  privacy: "/privacy/",
};

/**
 * Public 60-second cached read of an owner-editable info page via apiServer's
 * node:http client (never fetch, never Cookie).
 */
export function getInfoPage(slug) {
  return apiServer(`/api/v1/site/pages/${encodeURIComponent(slug)}/`);
}

function toAxiosLikeError(error) {
  if (!error) return error;
  if (error.response) return error;
  if (typeof error.status === "number" && error.status > 0) {
    return {
      ...error,
      message: error.message,
      response: { status: error.status, data: {} },
    };
  }
  const isTimeout = /timeout/i.test(String(error.message || ""));
  return {
    ...error,
    message: error.message,
    code: isTimeout ? "ECONNABORTED" : error.code,
  };
}

/**
 * Loads one info page for SSR:
 * - published page -> { page, notFound: false, errorMessage: null }
 * - Django 404 (unpublished or missing) -> { page: null, notFound: true, errorMessage: null }
 * - upstream error / timeout / 5xx -> { page: null, notFound: false, errorMessage }
 *   so the route fails open with its retryable fallback instead of a false 404
 *   or an unhandled 500.
 */
export async function loadInfoPage(slug) {
  try {
    const data = await getInfoPage(slug);
    if (!data || data.body === undefined) {
      return { page: null, notFound: true, errorMessage: null };
    }
    return { page: data, notFound: false, errorMessage: null };
  } catch (error) {
    if (isNotFound(error)) {
      return { page: null, notFound: true, errorMessage: null };
    }
    return {
      page: null,
      notFound: false,
      errorMessage: normalizeApiError(toAxiosLikeError(error)).message,
    };
  }
}
