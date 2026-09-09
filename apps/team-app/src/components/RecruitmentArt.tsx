/** Decorative recruitment illustration; contains no applicant or business data. */
export default function RecruitmentArt() {
  return (
    <svg className="recruitment-art" viewBox="0 0 420 280" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="orbit" x1="40" y1="30" x2="380" y2="260" gradientUnits="userSpaceOnUse">
          <stop stopColor="#90c0f8" /><stop offset="1" stopColor="#36c6c0" />
        </linearGradient>
      </defs>
      <circle cx="215" cy="140" r="115" stroke="url(#orbit)" strokeOpacity=".3" />
      <circle cx="215" cy="140" r="86" stroke="url(#orbit)" strokeOpacity=".2" strokeDasharray="5 9" />
      <path d="M105 83L222 142L332 76M222 142L315 225M222 142L86 212" stroke="#7cdad9" strokeWidth="2" strokeDasharray="5 6" />
      <rect x="158" y="87" width="122" height="113" rx="25" fill="url(#orbit)" />
      <rect x="189" y="124" width="60" height="44" rx="9" stroke="#0b284c" strokeWidth="4" />
      <path d="M207 124V116H232V124M190 144H248M218 139V149" stroke="#0b284c" strokeWidth="4" strokeLinejoin="round" />
      {[{x:45,y:28},{x:292,y:20},{x:32,y:174}].map(({x,y}) => (
        <g key={x} transform={`translate(${x} ${y})`}>
          <rect width="105" height="82" rx="17" fill="#f6fbff" />
          <circle cx="28" cy="29" r="14" fill="#d4eef4" />
          <circle cx="28" cy="25" r="5" fill="#246782" />
          <path d="M19 37C19 27 37 27 37 37" fill="#246782" />
          <path d="M52 25H88M52 35H77M18 58H86M18 66H60" stroke="#9fbdcf" strokeWidth="4" strokeLinecap="round" />
        </g>
      ))}
      <circle cx="321" cy="223" r="25" fill="#36c6c0" />
      <path d="M310 222L318 230L333 214" stroke="#0b284c" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M180 23V39M172 31H188M375 160V176M367 168H383" stroke="#90c0f8" strokeWidth="3" strokeLinecap="round" />
      <circle cx="152" cy="236" r="4" fill="#36c6c0" />
    </svg>
  );
}
