interface DemoEmployee extends Record<string, unknown> {
  id: string;
}

interface FirmRestriction extends Record<string, unknown> {
  ticker?: string;
}

interface DemoData extends Record<string, unknown> {
  demo_employees?: DemoEmployee[];
  firm_restricted_list?: FirmRestriction[];
  quick_reference?: Record<string, unknown>;
}

const DATA_PATH = new URL("../../demo_data_simple.json", import.meta.url);

let cachedData: DemoData | null = null;
let loadPromise: Promise<DemoData> | null = null;

async function loadDemoData(): Promise<DemoData> {
  if (cachedData) {
    return cachedData;
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      const file = Bun.file(DATA_PATH);
      if (!(await file.exists())) {
        throw new Error(
          `demo_data_simple.json not found at ${DATA_PATH.pathname}`,
        );
      }
      const raw = await file.text();
      const parsed = JSON.parse(raw) as DemoData;
      cachedData = parsed;
      loadPromise = null;
      return parsed;
    })();
  }

  return loadPromise;
}

export async function getDemoData(): Promise<DemoData> {
  return loadDemoData();
}

export async function getEmployeeById(
  employeeId: string,
): Promise<DemoEmployee | null> {
  if (!employeeId) {
    return null;
  }
  const data = await loadDemoData();
  const normalized = employeeId.trim().toUpperCase();
  const employee = data.demo_employees?.find(
    (emp) => emp.id?.toUpperCase() === normalized,
  );
  return employee ?? null;
}

export async function getFirmRestrictions(): Promise<{
  firm_restricted_list: FirmRestriction[];
  quick_reference?: Record<string, unknown>;
}> {
  const data = await loadDemoData();
  return {
    firm_restricted_list: data.firm_restricted_list ?? [],
    quick_reference: data.quick_reference,
  };
}

export function clearDemoDataCache() {
  cachedData = null;
  loadPromise = null;
}

