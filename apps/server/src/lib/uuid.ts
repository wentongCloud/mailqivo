/** 路径参数是否为 UUID。查询 uuid 列前先校验，否则 PostgreSQL 报 22P02，请求变成 500。 */
export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
