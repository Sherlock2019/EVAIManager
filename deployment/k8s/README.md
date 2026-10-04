# Kubernetes examples (optional)

Kubernetes is **not** needed to run the lab — `docker compose up --build` is the
supported path. These manifests show how the same two containers map onto a
cluster, and how the service layer would be split in production.

| File | What it is |
|---|---|
| `mobility-lab.yaml` | Runnable example: backend (1 replica, PVC for SQLite), dashboard (2 replicas), services and an ingress |
| `production-topology.yaml` | Conceptual only: one deployment per service, GPU and CPU node pools, autoscaling on stream lag |

## Try it on a local cluster (kind / minikube / Docker Desktop)

```bash
# build the images
docker build -t vinfast-ai-mobility-lab/backend:latest  backend
docker build -t vinfast-ai-mobility-lab/frontend:latest frontend

# make them visible to the cluster (kind shown; minikube: `minikube image load ...`)
kind load docker-image vinfast-ai-mobility-lab/backend:latest vinfast-ai-mobility-lab/frontend:latest

kubectl apply -f deployment/k8s/mobility-lab.yaml
kubectl -n mobility-lab rollout status deploy/backend

# open the dashboard without an ingress controller
kubectl -n mobility-lab port-forward svc/dashboard 8080:80
```

Then open http://localhost:8080.

These manifests were written as examples and have not been run against a
cluster as part of this project; expect to adjust storage class and ingress
class for yours.

## Why the backend is a single replica here

The demo keeps the live simulation in process memory and stores application
data in SQLite. That is the right trade for a laptop demo and the wrong one for
production: there, the simulator is replaced by the real vehicle gateway and
event stream, state moves to a telemetry store and a relational database, and
each service in `backend/app/services` becomes its own stateless deployment —
which is what `production-topology.yaml` sketches.
