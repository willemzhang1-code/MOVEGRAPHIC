// Two-color tint, premultiplied output. Works in the built-in pipeline and URP (unlit).
Shader "RABBIT/Skeleton"
{
    Properties
    {
        _MainTex ("Atlas page", 2D) = "white" {}
        [Toggle] _StraightAlpha ("Straight-alpha texture (premultiply in shader)", Float) = 0
        [HideInInspector] _SrcBlend ("Src blend", Float) = 1
        [HideInInspector] _DstBlend ("Dst blend", Float) = 10
    }
    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" "IgnoreProjector" = "True" "PreviewType" = "Plane" }
        Cull Off
        ZWrite Off
        Lighting Off
        Blend [_SrcBlend] [_DstBlend]

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            sampler2D _MainTex;
            float _StraightAlpha;

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
                float3 dark : TEXCOORD1;
                fixed4 color : COLOR;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 dark : TEXCOORD1;
                fixed4 light : COLOR;
            };

            v2f vert (appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = v.uv;
                o.dark = v.dark;
                o.light = v.color;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 t = tex2D(_MainTex, i.uv);
                t.rgb *= lerp(1, t.a, _StraightAlpha);
                float3 rgb = t.rgb * i.light.rgb + (t.a - t.rgb) * i.dark;
                return fixed4(rgb * i.light.a, t.a * i.light.a);
            }
            ENDCG
        }
    }
}
