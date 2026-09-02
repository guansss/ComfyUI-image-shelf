// @ts-expect-error I don't know how to properly get this to work
import { api as _api } from "/scripts/api.js"
// @ts-expect-error I don't know how to properly get this to work
import { app as _app } from "/scripts/app.js"
import { ComfyApi, ComfyApp } from "@comfyorg/comfyui-frontend-types"

export const app: ComfyApp = _app
export const api: ComfyApi = _api
