import type { FastifyPluginAsync } from "fastify";
import {
  ContactDeleteBody,
  ContactLanguageBody,
  ContactStatusBody,
  ContactTagsBody,
  CreateContactBody,
  UpdateContactBody,
  contactFilterFromQuery
} from "@mailqivo/shared";
import { parseOrThrow } from "../../lib/errors.ts";
import { localeFromRequest } from "../../lib/locale.ts";
import { parsePagination, toPage } from "../../lib/pagination.ts";
import { applyContactTags } from "../tags/service.ts";
import { buildContactsWorkbook } from "./export.ts";
import {
  createContact,
  deleteContact,
  deleteContacts,
  getContact,
  searchContacts,
  updateContact,
  updateContactLanguage,
  updateContactStatus
} from "./service.ts";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** 挂载在 /api/contacts 下（§10.1）。静态路径（status / tags / export.xlsx）优先于 /:id。 */
export const contactRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request) => {
    const filter = parseOrThrow({ parse: contactFilterFromQuery }, request.query);
    const page = parsePagination(request.query);
    const { items, total } = await searchContacts(app.db, filter, page);
    return toPage(items, total, page);
  });

  app.post("/", async (request, reply) => {
    const body = parseOrThrow(CreateContactBody, request.body);
    reply.status(201);
    return createContact(app.db, body);
  });

  app.post("/tags", async (request) => {
    return applyContactTags(app.db, parseOrThrow(ContactTagsBody, request.body));
  });

  app.post("/status", async (request) => {
    return updateContactStatus(app.db, parseOrThrow(ContactStatusBody, request.body));
  });

  app.post("/delete", async (request) => {
    return deleteContacts(app.db, parseOrThrow(ContactDeleteBody, request.body));
  });

  app.post("/language", async (request) => {
    return updateContactLanguage(app.db, parseOrThrow(ContactLanguageBody, request.body));
  });

  app.get("/export.xlsx", async (request, reply) => {
    const filter = parseOrThrow({ parse: contactFilterFromQuery }, request.query);
    const buffer = await buildContactsWorkbook(app.db, filter, localeFromRequest(request));
    return reply
      .header("content-type", XLSX_MIME)
      .header("content-disposition", 'attachment; filename="contacts.xlsx"')
      .send(buffer);
  });

  app.get<{ Params: { id: string } }>("/:id", async (request) => getContact(app.db, request.params.id));

  app.patch<{ Params: { id: string } }>("/:id", async (request) => {
    return updateContact(app.db, request.params.id, parseOrThrow(UpdateContactBody, request.body));
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request) => {
    await deleteContact(app.db, request.params.id);
    return { ok: true };
  });
};
