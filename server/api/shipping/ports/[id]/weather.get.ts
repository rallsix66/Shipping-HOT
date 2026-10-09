import process from "node:process"
import { getShippingSnapshot } from "#/shipping-store"
import { getPortWeatherPanel } from "#/services/port-weather-panel"
import { providerModes } from "#/providers/shipping"
import { ShippingRepository } from "#/database/shipping"

export default defineEventHandler(async (event) => {
  const portId = getRouterParam(event, "id")
  if (!portId) throw createError({ statusCode: 400, statusMessage: "port id required" })
  const snapshot = await getShippingSnapshot()
  const port = snapshot.ports.find(item => item.id === portId)
  if (!port) throw createError({ statusCode: 404, statusMessage: "port not found" })
  const db = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  const repository = new ShippingRepository(db, dataMode)
  const forecastLabel = providerModes.weather === "open-meteo"
    ? "Open-Meteo Marine + Forecast（CC BY 4.0）"
    : `${providerModes.weather}（未写入持久化预报）`
  const alertsLabel = providerModes.weatherAlerts === "public"
    ? "官方预警 public"
    : providerModes.weatherAlerts === "experimental"
      ? "官方预警 experimental"
      : "官方预警 off"
  return getPortWeatherPanel(repository, portId, snapshot.feedItems, forecastLabel, alertsLabel)
})
