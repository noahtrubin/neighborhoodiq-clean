#!/usr/bin/env bash
# Deploy the monthly model-refresh as a Cloud Run JOB + Cloud Scheduler trigger.
# Requires: gcloud CLI installed and authenticated (gcloud auth login), Blaze billing.
# Run from this directory:  cd model-refresh && ./deploy.sh
#
# Idempotent-ish: "create" steps that already exist are tolerated. Re-running
# "gcloud run jobs deploy" updates the job in place.
set -euo pipefail

PROJECT="neighborhoodiq-cb9eb"
REGION="us-central1"
JOB="neighborhoodiq-monthly-job"
RUNTIME_SA="neighborhoodiq-job-runtime"
INVOKER_SA="neighborhoodiq-scheduler-invoker"
SCHED="neighborhoodiq-monthly-trigger"
CRON="0 6 1 * *"            # 06:00 on the 1st of each month
TZ="America/New_York"

RUNTIME_EMAIL="${RUNTIME_SA}@${PROJECT}.iam.gserviceaccount.com"
INVOKER_EMAIL="${INVOKER_SA}@${PROJECT}.iam.gserviceaccount.com"

echo "==> Using project ${PROJECT}, region ${REGION}"
gcloud config set project "${PROJECT}" >/dev/null

echo "==> 1/6 Enabling APIs"
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com iam.googleapis.com \
  firestore.googleapis.com --project="${PROJECT}"

echo "==> 2/6 Runtime service account (the job runs as this; needs Firestore write)"
gcloud iam service-accounts create "${RUNTIME_SA}" \
  --display-name="NeighborhoodIQ job runtime" --project="${PROJECT}" 2>/dev/null \
  || echo "    (runtime SA already exists)"
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member="serviceAccount:${RUNTIME_EMAIL}" \
  --role="roles/datastore.user" --condition=None >/dev/null

# The deploying identity must be able to act-as the runtime SA, or
# `run jobs deploy --service-account=...` fails unless it's Owner.
DEPLOYER="$(gcloud config get-value account 2>/dev/null)"
echo "    granting ${DEPLOYER} actAs on ${RUNTIME_SA}"
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_EMAIL}" \
  --member="user:${DEPLOYER}" --role="roles/iam.serviceAccountUser" \
  --project="${PROJECT}" >/dev/null
sleep 10   # let the SA + IAM bindings propagate before they're used

echo "==> 3/6 Build + deploy the Cloud Run JOB (builds image via Cloud Build)"
gcloud run jobs deploy "${JOB}" \
  --source=. \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --memory=4Gi \
  --cpu=2 \
  --task-timeout=30m \
  --max-retries=1 \
  --tasks=1 \
  --service-account="${RUNTIME_EMAIL}" \
  --set-env-vars="TRAIN_BASE=2019,SCORE_BASE=2024"

echo "==> 4/6 Scheduler invoker service account (+ run.invoker on the job)"
gcloud iam service-accounts create "${INVOKER_SA}" \
  --display-name="Cloud Scheduler -> Cloud Run Job invoker" --project="${PROJECT}" 2>/dev/null \
  || echo "    (invoker SA already exists)"
# Prefer the per-job binding; fall back to project-scoped run.invoker on older gcloud.
gcloud run jobs add-invoker-policy-binding "${JOB}" \
  --region="${REGION}" --project="${PROJECT}" \
  --member="serviceAccount:${INVOKER_EMAIL}" 2>/dev/null \
  || gcloud projects add-iam-policy-binding "${PROJECT}" \
       --member="serviceAccount:${INVOKER_EMAIL}" \
       --role="roles/run.invoker" --condition=None >/dev/null

echo "==> 5/6 Monthly Cloud Scheduler trigger (OAuth — run.googleapis.com is a Google API)"
SCHED_URI="https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${JOB}:run"
gcloud scheduler jobs create http "${SCHED}" \
  --location="${REGION}" --project="${PROJECT}" \
  --schedule="${CRON}" --time-zone="${TZ}" \
  --uri="${SCHED_URI}" --http-method=POST \
  --oauth-service-account-email="${INVOKER_EMAIL}" \
  --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform" 2>/dev/null \
  || gcloud scheduler jobs update http "${SCHED}" \
       --location="${REGION}" --project="${PROJECT}" \
       --schedule="${CRON}" --time-zone="${TZ}" \
       --uri="${SCHED_URI}" --http-method=POST \
       --oauth-service-account-email="${INVOKER_EMAIL}" \
       --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform"

echo "==> 6/6 Done — NOT auto-running the job (a real run overwrites production"
echo "    Firestore scores; we don't want that on every re-deploy)."
echo ""
echo "Populate Firestore now with one real run:"
echo "  gcloud run jobs execute ${JOB} --region=${REGION} --project=${PROJECT}"
echo "Watch logs:"
echo "  gcloud run jobs executions list --job=${JOB} --region=${REGION} --project=${PROJECT}"
echo "Scheduler will run it monthly: ${CRON} (${TZ})."
