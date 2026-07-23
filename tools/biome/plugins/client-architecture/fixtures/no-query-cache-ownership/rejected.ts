

import {useQueryClient as useClient} from '@tanstack/react-query';

const queryClient = useClient();
queryClient.setQueryData(['projects'], []);
