import { useSecretStatus } from '@/lib/accounts/secrets'
import { OpenMayhemSetup } from './OpenMayhemSetup'
import { SecretKeyField } from './SecretKeyField'

export function OpenMayhemMediaKey() {
  const { saved } = useSecretStatus()
  return <>
    <OpenMayhemSetup media />
    <SecretKeyField name="openMayhemApiKey" label="OpenMayhem API key" saved={saved.openMayhemApiKey}
      hint="One key for OpenMayhem chat, images and voice. Saved encrypted to your account on your Lost Tales Engine server." />
  </>
}
