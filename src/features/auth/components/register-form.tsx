"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField, FormLabel, FormError } from "@/components/ui/form";
import { Lock, Mail, User, Building, ArrowRight, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { registerAction } from "../actions/register-action";


export function RegisterForm() {
  const router = useRouter();
  const { toast, error: toastError } = useToast();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [password, setPassword] = useState("");

  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>(undefined);

  // Password strength criteria
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setFieldErrors(undefined);
    setIsLoading(true);

    try {
      const result = await registerAction({
        fullName,
        email,
        companyName,
        password,
        agreeToTerms,
      });

      if (!result.success || !result.data) {
        const errorMsg = result.error || "Registration failed.";
        setErrorMessage(errorMsg);
        setFieldErrors(result.fieldErrors);
        toastError("Registration Failed", errorMsg);
        return;
      }

      toast.success("Account request accepted.", {
        description: "Contact an administrator for an invitation.",
      });
      router.push("/login");
    } catch (err: any) {
      setErrorMessage(err?.message || "Registration failed.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card variant="glass" className="p-2">
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl">Create your NexusOS Account</CardTitle>
        <CardDescription>
          Join your organization portal to access digital services.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3">
          {errorMessage && <FormError>{errorMessage}</FormError>}

          <FormField>
            <FormLabel htmlFor="fullName">Full Name</FormLabel>
            <div className="relative">
              <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="fullName"
                type="text"
                placeholder="Alex Morgan"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="pl-9"
                error={!!fieldErrors?.fullName}
                required
              />
            </div>
            {fieldErrors?.fullName && <FormError>{fieldErrors.fullName[0]}</FormError>}
          </FormField>

          <FormField>
            <FormLabel htmlFor="companyName">Company / Organization</FormLabel>
            <div className="relative">
              <Building className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="companyName"
                type="text"
                placeholder="Acme Corp (Optional)"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="pl-9"
              />
            </div>
          </FormField>

          <FormField>
            <FormLabel htmlFor="email">Work Email</FormLabel>
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="alex@acme.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9"
                error={!!fieldErrors?.email}
                required
              />
            </div>
            {fieldErrors?.email && <FormError>{fieldErrors.email[0]}</FormError>}
          </FormField>

          <FormField>
            <FormLabel htmlFor="password">Password</FormLabel>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-9"
                error={!!fieldErrors?.password}
                required
              />
            </div>
            {fieldErrors?.password && <FormError>{fieldErrors.password[0]}</FormError>}

            {/* Password indicators */}
            <div className="grid grid-cols-3 gap-1 pt-1 text-[10px]">
              <span className={`flex items-center gap-1 ${hasMinLength ? "text-emerald-500 font-medium" : "text-muted-foreground"}`}>
                <CheckCircle2 className="h-3 w-3" /> 8+ Chars
              </span>
              <span className={`flex items-center gap-1 ${hasUppercase ? "text-emerald-500 font-medium" : "text-muted-foreground"}`}>
                <CheckCircle2 className="h-3 w-3" /> 1 Uppercase
              </span>
              <span className={`flex items-center gap-1 ${hasNumber ? "text-emerald-500 font-medium" : "text-muted-foreground"}`}>
                <CheckCircle2 className="h-3 w-3" /> 1 Number
              </span>
            </div>
          </FormField>


          <div className="flex items-start space-x-2 pt-2">
            <input
              id="terms"
              type="checkbox"
              checked={agreeToTerms}
              onChange={(e) => setAgreeToTerms(e.target.checked)}
              className="h-4 w-4 rounded border-input text-primary focus:ring-primary cursor-pointer mt-0.5"
              required
            />
            <label htmlFor="terms" className="text-xs text-muted-foreground cursor-pointer select-none leading-snug">
              I agree to the Terms of Service and Privacy Policy.
            </label>
          </div>
          {fieldErrors?.agreeToTerms && <FormError>{fieldErrors.agreeToTerms[0]}</FormError>}
        </CardContent>

        <CardFooter className="flex flex-col gap-4 pt-2">
          <Button type="submit" variant="glow" className="w-full" isLoading={isLoading}>
            <span>Create Account</span>
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>

          <div className="text-center text-xs text-muted-foreground">
            Already registered?{" "}
            <Link href="/login" className="text-primary font-semibold hover:underline">
              Sign in
            </Link>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
