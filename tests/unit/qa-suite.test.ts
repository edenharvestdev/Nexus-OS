import { describe, expect, it } from "vitest";
import { loginSchema } from "@/features/auth/schemas/auth-schemas";
import { clientFormSchema } from "@/features/clients/schemas/client-schema";
import {
  assignServiceSchema,
  serviceCategorySchema,
} from "@/features/services/schemas/service-schema";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

describe("authentication input validation", () => {
  it("normalizes omitted rememberMe to a fail-safe false value", () => {
    const result = loginSchema.parse({
      email: "client@example.com",
      password: "x".repeat(16),
    });

    expect(result.rememberMe).toBe(false);
  });

  it("rejects malformed credentials before an authentication request", () => {
    const result = loginSchema.safeParse({
      email: "not-an-email",
      password: "short",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toMatchObject({
        email: ["Invalid email address format"],
        password: ["Password must be at least 6 characters"],
      });
    }
  });
});

describe("client and service production schemas", () => {
  it("applies client defaults used by the persistence layer", () => {
    const result = clientFormSchema.parse({
      name: "Alex Client",
      companyName: "Example Co",
      email: "alex@example.com",
      country: "US",
    });

    expect(result).toMatchObject({
      clientStatus: "active",
      preferredCurrency: "USD",
      preferredLanguage: "en",
      timezone: "UTC",
      tags: [],
    });
  });

  it("rejects a service assignment without a client boundary", () => {
    const result = assignServiceSchema.safeParse({
      clientId: "",
      customName: "Managed Hosting",
      customPrice: 49.99,
      currency: "USD",
      billingCycle: "monthly",
      serviceStatus: "active",
      autoRenewal: true,
    });

    expect(result.success).toBe(false);
  });

  it("accepts a valid service category consumed by admin actions", () => {
    const result = serviceCategorySchema.safeParse({
      name: "Managed Cloud VPS",
      description: "High performance cloud server instance",
      iconName: "Server",
      color: "blue",
    });

    expect(result.success).toBe(true);
  });
});

describe("shared presentation utilities", () => {
  it("resolves conflicting Tailwind utilities", () => {
    expect(cn("px-2 text-sm", false && "hidden", "px-4")).toBe("text-sm px-4");
  });

  it("formats currency with the requested ISO currency", () => {
    expect(formatCurrency(49.99, "USD")).toBe("$49.99");
  });

  it("formats dates consistently for user-facing views", () => {
    expect(formatDate("2026-07-22T00:00:00.000Z")).toBe("Jul 22, 2026");
  });
});
