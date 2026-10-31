package dev.protocolia.modular;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Map;
import java.util.HashMap;
import java.util.HashSet;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** S2c-1c0: authenticate a provider-neutral raw HTTP envelope, not a settlement.
 * No controller invokes this until a provider-specific contract and durable replay
 * inbox are independently reviewed. Keys MUST come from trusted server configuration.
 */
public final class ProviderWebhookVerifier {
  private ProviderWebhookVerifier() {}

  /** Trusted demo-only keyring; no client-supplied identity or key fallback.
   * Removing an ID revokes it for new requests without changing stored events.
   */
  public static Map<String,byte[]> parseSandboxKeys(String legacyHex,String keyring) {
    String legacy=legacyHex==null?"":legacyHex;
    String configured=keyring==null?"":keyring;
    if(!legacy.isEmpty()&&!configured.isEmpty())return null;
    String[] entries=!configured.isEmpty()?configured.split(",",-1):
      !legacy.isEmpty()?new String[]{"sandbox_1="+legacy}:new String[0];
    if(entries.length<1||entries.length>3)return null;
    var keys=new HashMap<String,byte[]>();
    var secrets=new HashSet<String>();
    for(String entry:entries){
      var matcher=Pattern.compile("([A-Za-z0-9_-]{1,32})=([0-9a-f]{64})").matcher(entry);
      if(!matcher.matches()||keys.containsKey(matcher.group(1))||
         !secrets.add(matcher.group(2)))return null;
      keys.put(matcher.group(1),HexFormat.of().parseHex(matcher.group(2)));
    }
    return Map.copyOf(keys);
  }
  public record Verified(String keyId,String eventId,String payloadSha256) {}
  private static final Pattern KEY=Pattern.compile("[A-Za-z0-9_-]{1,32}");
  private static final Pattern EVENT=Pattern.compile("[A-Za-z0-9_-]{8,128}");
  private static final Pattern SECONDS=Pattern.compile("[1-9][0-9]{9}");
  private static final Pattern SIGNATURE=Pattern.compile("v2=[0-9a-f]{64}");
  private static final String DOMAIN="protocolia-provider-proof-v2\n";

  public static Verified verify(String purpose,String keyId,String timestamp,String eventId,
      String signature,byte[] rawBody,Map<String,byte[]> trustedKeys,long nowSeconds) {
    if(purpose==null||!(purpose.equals("inbox")||purpose.equals("receipt-candidate")||
       purpose.equals("lifecycle-observation"))||
       keyId==null||!KEY.matcher(keyId).matches()||
       timestamp==null||!SECONDS.matcher(timestamp).matches()||
       eventId==null||!EVENT.matcher(eventId).matches()||
       signature==null||!SIGNATURE.matcher(signature).matches()||
       rawBody==null||rawBody.length<1||rawBody.length>65536||
       trustedKeys==null||trustedKeys.size()<1||trustedKeys.size()>3||
       trustedKeys.keySet().stream().anyMatch(k->k==null||!KEY.matcher(k).matches())||
       nowSeconds<0)return null;
    byte[] secret=trustedKeys.get(keyId);
    if(secret==null||secret.length!=32)return null;
    long seconds;
    try{seconds=Long.parseLong(timestamp);}
    catch(NumberFormatException ex){return null;}
    if(seconds<nowSeconds-300||seconds>nowSeconds+300)return null;
    try {
      Mac mac=Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret,"HmacSHA256"));
      mac.update((DOMAIN+purpose+"\n"+keyId+"\n"+timestamp+"\n"+eventId+"\n")
        .getBytes(StandardCharsets.UTF_8));
      byte[] expected=mac.doFinal(rawBody);
      byte[] received=HexFormat.of().parseHex(signature.substring(3));
      if(!MessageDigest.isEqual(expected,received))return null;
      byte[] digest=MessageDigest.getInstance("SHA-256").digest(rawBody);
      return new Verified(keyId,eventId,HexFormat.of().formatHex(digest));
    }catch(java.security.GeneralSecurityException ex){
      throw new IllegalStateException("JVM cryptography unavailable",ex);
    }
  }
}
