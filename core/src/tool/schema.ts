/**
 * 文件作用：实现 XMA Tool 输入参数的最小 JSON Schema 校验器，确保模型参数在进入 Policy/Approval/Execute 前先被拒绝或规范化。
 * 关联模块：router.ts、../model.ts、Provider adapters、未来 DSH Tool Compatibility。
 * 当前实现：object/array/string/number/integer/boolean/null、required/properties/additionalProperties、enum/const、oneOf、长度与数值边界。
 * 职责边界：这里不是通用 JSON Schema 引擎；遇到会影响安全语义但尚未支持的 schema 形状必须 fail loud，禁止静默放宽。
 */

import type { JsonObject, JsonValue } from '../types.ts'

export interface ToolSchemaValidationResult {
  ok: boolean
  errors: readonly string[]
}

type SchemaRecord = Record<string, JsonValue>

type JsonTypeName = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'

const SUPPORTED_TYPES = new Set<JsonTypeName>(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
const UNSUPPORTED_SECURITY_KEYWORDS = [
  '$ref', '$defs', 'allOf', 'anyOf', 'not', 'if', 'then', 'else', 'dependentRequired', 'dependentSchemas',
  'patternProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'prefixItems',
] as const

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function valueType(value: JsonValue): JsonTypeName {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value as Exclude<JsonTypeName, 'object' | 'array' | 'null' | 'integer'> | 'object'
}

function describePath(path: string): string {
  return path.length === 0 ? '$' : path
}

function schemaTypeMatches(value: JsonValue, type: JsonTypeName): boolean {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isObject(value)
  if (type === 'null') return value === null
  return typeof value === type
}

function equalJson(a: JsonValue, b: JsonValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function expectNumber(schema: SchemaRecord, key: string, path: string, errors: string[]): number | undefined {
  const raw = schema[key]
  if (raw === undefined) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    errors.push(`${describePath(path)} schema keyword ${key} must be a finite number.`)
    return undefined
  }
  return raw
}

function validateSchemaShape(schema: SchemaRecord, path: string, errors: string[]): void {
  for (const key of UNSUPPORTED_SECURITY_KEYWORDS) {
    if (schema[key] !== undefined) {
      errors.push(`${describePath(path)} schema keyword ${key} is not supported by XMA yet.`)
    }
  }
  const rawType = schema.type
  if (rawType !== undefined) {
    const values = Array.isArray(rawType) ? rawType : [rawType]
    if (values.length === 0 || values.some(value => typeof value !== 'string' || !SUPPORTED_TYPES.has(value as JsonTypeName))) {
      errors.push(`${describePath(path)} schema has an unsupported type declaration.`)
    }
  }
}

function validateValue(value: JsonValue, schemaValue: JsonValue, path: string, errors: string[]): void {
  if (!isObject(schemaValue)) {
    errors.push(`${describePath(path)} schema node must be an object.`)
    return
  }
  const schema: SchemaRecord = schemaValue
  validateSchemaShape(schema, path, errors)
  if (errors.length > 32) return

  const oneOf = schema.oneOf
  if (oneOf !== undefined) {
    if (!Array.isArray(oneOf) || oneOf.length === 0) {
      errors.push(`${describePath(path)} schema oneOf must be a non-empty array.`)
      return
    }
    let matched = 0
    for (const branch of oneOf) {
      const branchErrors: string[] = []
      validateValue(value, branch, path, branchErrors)
      if (branchErrors.length === 0) matched += 1
    }
    if (matched !== 1) errors.push(`${describePath(path)} must match exactly one oneOf branch; matched ${matched}.`)
    return
  }

  const rawType = schema.type
  if (rawType !== undefined) {
    const types = (Array.isArray(rawType) ? rawType : [rawType]).filter((item): item is string => typeof item === 'string')
    const validTypes = types.filter((item): item is JsonTypeName => SUPPORTED_TYPES.has(item as JsonTypeName))
    if (validTypes.length > 0 && !validTypes.some(type => schemaTypeMatches(value, type))) {
      errors.push(`${describePath(path)} expected ${validTypes.join('|')}, got ${valueType(value)}.`)
      return
    }
  }

  if (schema.const !== undefined && !equalJson(value, schema.const)) {
    errors.push(`${describePath(path)} must equal the schema const value.`)
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(candidate => equalJson(value, candidate))) {
    errors.push(`${describePath(path)} must be one of the schema enum values.`)
  }

  if (typeof value === 'string') {
    const minLength = expectNumber(schema, 'minLength', path, errors)
    const maxLength = expectNumber(schema, 'maxLength', path, errors)
    if (minLength !== undefined && value.length < minLength) errors.push(`${describePath(path)} is shorter than minLength ${minLength}.`)
    if (maxLength !== undefined && value.length > maxLength) errors.push(`${describePath(path)} is longer than maxLength ${maxLength}.`)
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(`${describePath(path)} does not match pattern ${schema.pattern}.`)
      } catch {
        errors.push(`${describePath(path)} schema pattern is invalid.`)
      }
    }
  }

  if (typeof value === 'number') {
    const minimum = expectNumber(schema, 'minimum', path, errors)
    const maximum = expectNumber(schema, 'maximum', path, errors)
    if (minimum !== undefined && value < minimum) errors.push(`${describePath(path)} is less than minimum ${minimum}.`)
    if (maximum !== undefined && value > maximum) errors.push(`${describePath(path)} is greater than maximum ${maximum}.`)
  }

  if (Array.isArray(value)) {
    const minItems = expectNumber(schema, 'minItems', path, errors)
    const maxItems = expectNumber(schema, 'maxItems', path, errors)
    if (minItems !== undefined && value.length < minItems) errors.push(`${describePath(path)} has fewer than minItems ${minItems}.`)
    if (maxItems !== undefined && value.length > maxItems) errors.push(`${describePath(path)} has more than maxItems ${maxItems}.`)
    if (schema.items !== undefined) {
      value.forEach((item, index) => validateValue(item, schema.items as JsonValue, `${path}[${index}]`, errors))
    }
    return
  }

  if (!isObject(value)) return

  const properties = schema.properties
  let propertySchemas: JsonObject = {}
  if (properties !== undefined) {
    if (!isObject(properties)) {
      errors.push(`${describePath(path)} schema properties must be an object.`)
      return
    }
    propertySchemas = properties
  }

  const required = schema.required
  if (required !== undefined) {
    if (!Array.isArray(required) || required.some(item => typeof item !== 'string')) {
      errors.push(`${describePath(path)} schema required must be an array of strings.`)
    } else {
      for (const key of required) {
        if (typeof key === 'string' && !Object.hasOwn(value, key)) errors.push(`${describePath(path)} is missing required property ${key}.`)
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    const childSchema = propertySchemas[key]
    if (childSchema !== undefined) {
      validateValue(child as JsonValue, childSchema, path ? `${path}.${key}` : `$.${key}`, errors)
      continue
    }
    const additionalProperties = schema.additionalProperties
    if (additionalProperties === false) errors.push(`${describePath(path)} contains unknown property ${key}.`)
    else if (isObject(additionalProperties)) validateValue(child as JsonValue, additionalProperties, path ? `${path}.${key}` : `$.${key}`, errors)
  }
}

/**
 * 校验模型产生的 Tool arguments。返回所有可读错误而不是抛出，让 Router 把普通参数错误结构化回模型自纠。
 */
export function validateToolArguments(argumentsValue: JsonObject, inputSchema: JsonObject): ToolSchemaValidationResult {
  const errors: string[] = []
  validateValue(argumentsValue, inputSchema, '$', errors)
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors.slice(0, 32)) })
}
