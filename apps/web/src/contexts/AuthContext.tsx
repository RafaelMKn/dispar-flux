import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getDeviceFingerprint, getStoredToken, setStoredToken, webApi } from '../services/api';

export interface MemberInfo {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'operator';
}

export interface DeviceInfo {
  id: string;
  name: string;
  isApproved?: boolean;
}

export interface OrgInfo {
  id: string;
  name: string;
  operational_timezone: string;
}

export type AuthStatus = 'loading' | 'unclaimed' | 'unauthenticated' | 'authenticated';

export interface ClaimData {
  claimCode: string;
  organizationName: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
  operationalTimezone: string;
}

export interface AuthContextType {
  status: AuthStatus;
  member: MemberInfo | null;
  device: DeviceInfo | null;
  organization: OrgInfo | null;
  login: (email: string, password: string) => Promise<{ requiresDeviceApproval?: boolean; deviceId?: string }>;
  claim: (data: ClaimData) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [organization, setOrganization] = useState<OrgInfo | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      // 1. Verify system claim status
      const sysStatus = await (webApi as any).auth.getStatus().catch(() => null);
      if (sysStatus && !sysStatus.isClaimed) {
        setStatus('unclaimed');
        setMember(null);
        return;
      }

      // 2. Verify active session
      const sessionData = await (webApi as any).auth.getSession().catch(() => null);
      if (sessionData && sessionData.member) {
        setMember(sessionData.member);
        setDevice(sessionData.device);
        if (sessionData.organization) {
          setOrganization(sessionData.organization);
        }
        setStatus('authenticated');
      } else {
        setStoredToken(null);
        setMember(null);
        setStatus('unauthenticated');
      }
    } catch {
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (email: string, password: string) => {
    const deviceFingerprint = getDeviceFingerprint();
    const deviceName = `${navigator.platform || 'Desktop'} (${navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Navegador Web'})`;

    const res = await (webApi as any).auth.login({
      email,
      password,
      deviceFingerprint,
      deviceName,
    });

    if (res.requiresDeviceApproval) {
      return { requiresDeviceApproval: true, deviceId: res.deviceId };
    }

    if (res.token) {
      setStoredToken(res.token);
      setMember(res.member);
      if (res.deviceId) {
        setDevice({ id: res.deviceId, name: deviceName });
      }
      setStatus('authenticated');
    }

    return { requiresDeviceApproval: false };
  }, []);

  const claim = useCallback(async (data: ClaimData) => {
    const res = await (webApi as any).auth.claim(data);
    if (res.token) {
      setStoredToken(res.token);
      await checkAuth();
    }
  }, [checkAuth]);

  const logout = useCallback(async () => {
    try {
      await (webApi as any).auth.logout().catch(() => {});
    } finally {
      setStoredToken(null);
      setMember(null);
      setDevice(null);
      setOrganization(null);
      setStatus('unauthenticated');
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        member,
        device,
        organization,
        login,
        claim,
        logout,
        refresh: checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
}
