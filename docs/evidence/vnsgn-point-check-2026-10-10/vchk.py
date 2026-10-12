import json, shapefile, math, urllib.request, datetime
from shapely.geometry import Point, LineString, Polygon, shape
from pyproj import Geod
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
G=Geod(ellps="WGS84")
P=(10.2917,107.0417); OFF=(10.77,106.75)
def km(a,b): return G.inv(a[1],a[0],b[1],b[0])[2]/1000
dms=lambda d,m,s: d+m/60+s/3600
HCM={"HCM1":(dms(10,19,15),dms(107,4,55)),"HCM2":(dms(10,19,10),dms(107,15,34)),"HCM3":(dms(10,7,9),dms(107,15,34)),"HCM4":(dms(10,7,11),dms(106,57,52)),"HCM5":(dms(10,15,0),dms(106,57,54)),"HCM6":(dms(10,16,54),dms(106,52,11)),"HCM7":(dms(10,16,54),dms(106,46,17))}
seq=[HCM[k] for k in ["HCM1","HCM2","HCM3","HCM4","HCM5","HCM6","HCM7"]]
# seaward-bounded envelope; landward side closed far north (land excluded separately by coastline test)
env=Polygon([(lo,la) for la,lo in seq]+[(106.7714,10.60),(107.0819,10.60)])
pt=Point(P[1],P[0])
out={}
out["inside_HCM_seaward_envelope"]=env.contains(pt)
# Natural Earth land
r=shapefile.Reader("ne/ne_10m_land.shp"); ne_land=[shape(s.__geo_interface__) for s in r.shapes()]
out["natural_earth_10m_on_land"]=any(g.contains(pt) for g in ne_land)
# OSM coastline: nearest segment + side (OSM: land on the LEFT of way direction)
d=json.load(open("osm.json")); best=None
lines=[]
for w in d["elements"]:
    g=[(n["lon"],n["lat"]) for n in w["geometry"]]; lines.append(g)
    for i in range(len(g)-1):
        a,b=g[i],g[i+1]; seg=LineString([a,b]); dd=seg.distance(pt)
        if best is None or dd<best[0]: best=(dd,a,b,w["id"])
_,a,b,wid=best
cross=(b[0]-a[0])*(P[0]-a[1])-(b[1]-a[1])*(P[1]-a[0])
seg=LineString([a,b]); q=seg.interpolate(seg.project(pt))
out["osm_nearest_coastline_way"]=wid
out["osm_nearest_coast_km"]=round(km(P,(q.y,q.x)),2)
out["osm_side"]="land(left)" if cross>0 else "water(right)"
out["osm_timestamp"]=d["osm3s"]["timestamp_osm_base"]
out["dist_official_VNSGN_km"]=round(km(P,OFF),1)
out["dist_HCM1_km"]=round(km(P,HCM["HCM1"]),1)
res=[]
for m in ["best_match","ncep_gfswave025"]:
    u=f"https://marine-api.open-meteo.com/v1/marine?latitude={P[0]}&longitude={P[1]}&hourly=wave_height,swell_wave_height&forecast_days=8&past_days=1&timeformat=unixtime&cell_selection=sea&models={m}"
    t=datetime.datetime.now(datetime.timezone.utc); j=json.load(urllib.request.urlopen(u,timeout=30))
    T=j["hourly"]["time"]; h=j["hourly"]; now=t.timestamp()
    s=math.ceil((now-3600)/3600)*3600; e=math.floor((now+7*86400)/3600)*3600
    exp=list(range(s,e+1,3600)); idx={x:i for i,x in enumerate(T)}
    have=[x for x in exp if x in idx and (h["wave_height"][idx[x]] is not None or h["swell_wave_height"][idx[x]] is not None)]
    cell=(j["latitude"],j["longitude"])
    res.append(dict(model=m,url=u,requested_at_utc=t.isoformat(timespec="seconds"),cell=cell,request_to_cell_km=round(km(P,cell),2),cell_to_official_km=round(km(cell,OFF),1),cell_inside_envelope=env.contains(Point(cell[1],cell[0])),total_hours=len(T),rolling7d=f"{len(have)}/{len(exp)}",window=[datetime.datetime.fromtimestamp(s,datetime.timezone.utc).isoformat(),datetime.datetime.fromtimestamp(e,datetime.timezone.utc).isoformat()]))
out["probes"]=res
json.dump(out,open("vnsgn-point-check.json","w"),indent=1,ensure_ascii=False); print(json.dumps(out,indent=1,ensure_ascii=False))
fig,ax=plt.subplots(figsize=(8,7))
for g in lines: ax.plot([x for x,_ in g],[y for _,y in g],color="saddlebrown",lw=0.8)
xs=[lo for la,lo in seq]; ys=[la for la,lo in seq]; ax.plot(xs,ys,"b--",lw=1.2,label="01/2026/TT-BXD HCM1–HCM7 (WGS-84, Annex II)")
for k,(la,lo) in HCM.items(): ax.annotate(k,(lo,la),fontsize=7,color="b")
ax.plot(P[1],P[0],"r*",ms=14,label="check point 10.2917N 107.0417E")
for r_ in res: ax.plot(r_["cell"][1],r_["cell"][0],"o",mfc="none",ms=10,label=f"{r_['model']} cell {r_['cell'][0]:.4f},{r_['cell'][1]:.4f}")
ax.set_xlim(106.74,107.30); ax.set_ylim(10.08,10.48); ax.set_aspect("equal"); ax.grid(alpha=.3)
ax.set_title("VNSGN engineering reference point check (coastline: OSM natural=coastline "+d["osm3s"]["timestamp_osm_base"]+")",fontsize=8)
ax.legend(fontsize=7,loc="lower left"); fig.savefig("vnsgn-point-check.png",dpi=130,bbox_inches="tight")
